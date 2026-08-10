/**
 * Pipeline de ingestão da Evolution API — a metade que ESCREVE no banco.
 * `webhook.ts` (ao lado) faz o parse puro; aqui mora tudo que fala com o
 * Supabase. Mesmo desenho de `lib/waha/ingest.ts`, mas deliberadamente mais
 * ENXUTO: cobre só telefone (sem `@lid`, sem grupo — ver `webhook.ts` e
 * `capabilities.ts` sobre `groups: "none"`) porque essas variantes exigem
 * medição contra payload real que ainda não temos para este provider. Reusa
 * as MESMAS RPCs atômicas do WAHA (`fn_upsert_wa_contact`/
 * `fn_upsert_wa_conversation`) — elas já são agnósticas de provider, não
 * conhecem "waha" nem "evolution_api", só telefone/lid/chat_id.
 */
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { garantirLeadDaConversa } from "@/lib/leads/nascimento-do-lead";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { EvolutionEvent } from "./webhook";

type Admin = ReturnType<typeof createAdminClient>;

interface Session {
  id: string;
  organization_id: string;
}

const STOP_RX = /\b(STOP|PARAR|SAIR|UNSUBSCRIBE)\b/i;

async function upsertContact(
  admin: Admin,
  orgId: string,
  phone: string,
  chatId: string,
  notifyName: string | null,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: orgId,
    p_kind: "phone",
    p_phone: `+${phone}`,
    p_lid: null,
    p_chat_id: chatId,
    p_notify: notifyName,
  } as never);
  if (error) {
    console.error("[evolution.ingest] fn_upsert_wa_contact failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

async function upsertConversation(
  admin: Admin,
  orgId: string,
  contactId: string,
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation" as never, {
    p_org: orgId,
    p_contact: contactId,
    p_session: sessionId,
  } as never);
  if (error) {
    console.error("[evolution.ingest] fn_upsert_wa_conversation failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

async function markConversation(
  admin: Admin,
  convId: string,
  direction: "inbound" | "outbound",
  preview: string,
  at: string,
): Promise<void> {
  const { error } = await admin.rpc("fn_mark_conversation_message" as never, {
    p_conv: convId,
    p_direction: direction,
    p_preview: preview,
    p_at: at,
  } as never);
  if (error) {
    console.error("[evolution.ingest] fn_mark_conversation_message failed", error.message);
  }
}

async function handleMessage(
  admin: Admin,
  session: Session,
  event: Extract<EvolutionEvent, { kind: "message" }>,
  requestId: string,
): Promise<void> {
  const chatId = `${event.fromPhone}@s.whatsapp.net`;
  const direction: "inbound" | "outbound" = event.fromMe ? "outbound" : "inbound";

  const contactId = await upsertContact(
    admin,
    session.organization_id,
    event.fromPhone,
    chatId,
    direction === "inbound" ? event.pushName : null,
  );
  if (!contactId) return;
  const conversationId = await upsertConversation(admin, session.organization_id, contactId, session.id);
  if (!conversationId) return;

  const now = new Date().toISOString();
  const sentAt = new Date(event.timestampMs).toISOString();
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      contact_id: contactId,
      external_id: event.externalId,
      type: event.mediaUrl ? "document" : "text",
      direction,
      status: direction === "inbound" ? "delivered" : "sent",
      body: event.body,
      media_url: event.mediaUrl,
      sent_via: "external_device",
      sent_at: sentAt,
      delivered_at: direction === "inbound" ? now : null,
      metadata: {},
    })
    .select("id")
    .maybeSingle();

  // Idempotência: 23505 = unique (organization_id, external_id) já ingerido.
  if (insertErr?.code === "23505") {
    logger.info("evolution.ingest: mensagem ja ingerida, dedup por external_id", {
      organization_id: session.organization_id,
      external_id: event.externalId,
      direcao: direction,
    });
    return;
  }
  if (insertErr) {
    console.error("[evolution.ingest] message insert failed", insertErr.message);
    return;
  }

  const preview = event.body ? event.body.slice(0, 280) : event.mediaUrl ? "[mídia]" : "";
  await markConversation(admin, conversationId, direction, preview, now);

  if (direction !== "inbound") return;

  if (event.body && STOP_RX.test(event.body)) {
    await admin
      .from("contacts")
      .update({ is_blocked: true, blocked_reason: "stop_keyword", blocked_at: now })
      .eq("id", contactId);
    await audit({
      action: "contact.blocked",
      organizationId: session.organization_id,
      resourceType: "contact",
      requestId,
      metadata: { reason: "stop_keyword", contact_id: contactId },
    });
  }

  await audit({
    action: "message.received",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: { conversation_id: conversationId, external_id: event.externalId },
  });

  try {
    await garantirLeadDaConversa(admin, {
      organizationId: session.organization_id,
      contactId,
      conversationId,
      nomeDoContato: event.pushName,
    });
  } catch (err) {
    logger.error("evolution.ingest: nascimento do lead falhou (a mensagem entra assim mesmo)", {
      organization_id: session.organization_id,
      conversation_id: conversationId,
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
  }

  if (!inserted?.id) return;
  const inboundMessageId = inserted.id;

  admin
    .rpc("emit_event" as never, {
      p_event_type: "ai_agent.dispatch_requested",
      p_entity_kind: "message",
      p_entity_id: inboundMessageId,
      p_payload: {
        organization_id: session.organization_id,
        conversation_id: conversationId,
        contact_id: contactId,
        channel_session_id: session.id,
        inbound_message_id: inboundMessageId,
      },
      p_metadata: { source: "evolution_webhook", request_id: requestId },
      p_organization_id: session.organization_id,
    } as never)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[evolution.ingest] emit dispatch_requested failed", error.message);
    });
}

async function handleConnectionUpdate(
  admin: Admin,
  session: Session,
  event: Extract<EvolutionEvent, { kind: "connection_update" }>,
): Promise<void> {
  // Vocabulário cru da Evolution → o mesmo que a coluna `channel_sessions.status`
  // já usa para os outros providers (STARTING/SCAN_QR_CODE/WORKING/STOPPED).
  const STATE_MAP: Record<string, string> = {
    open: "WORKING",
    connecting: "SCAN_QR_CODE",
    close: "STOPPED",
  };
  const status = STATE_MAP[event.state];
  if (!status) return;
  await admin
    .from("channel_sessions")
    .update({ status, last_status_change_at: new Date().toISOString() })
    .eq("id", session.id);
}

export async function dispatchEvolutionEvent(
  admin: Admin,
  session: Session,
  event: EvolutionEvent,
  requestId: string,
): Promise<void> {
  if (!event) return;
  if (event.kind === "message") {
    await handleMessage(admin, session, event, requestId);
  } else {
    await handleConnectionUpdate(admin, session, event);
  }
}
