/**
 * POST /api/v1/webhooks/evolution/[token]
 *
 * Webhook da Evolution API. Diferente dos outros dois canais que assinam
 * (HMAC SHA512 e SHA256), este motor não assina o corpo por padrão — a defesa
 * é o token opaco no path (mesma coluna
 * `webhook_path_token` que os outros canais já usam), verificado ao resolver
 * a sessão. Pipeline: lookup por token → parse puro (`lib/channels/evolution/
 * webhook.ts`) → ingestão (`lib/channels/evolution/ingest.ts`).
 *
 * Sem log em `webhook_events_log`: a mesma decisão que o webhook do canal
 * oficial (Meta) já toma — a coluna `provider` dessa tabela nunca foi
 * estendida além de `waha`/`nuvemshop`/`generic` (nenhum dos providers
 * adicionados depois logou ali).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { CHANNEL_PROVIDER_EVOLUTION } from "@/lib/channels/capabilities";
import { dispatchEvolutionEvent } from "@/lib/channels/evolution/ingest";
import { parseEvolutionWebhook } from "@/lib/channels/evolution/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  if (!token || token.length < 8) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  const rawBody = await req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }

  const admin = createAdminClient();

  // Canal arquivado não ingere — mesma decisão do WAHA (ver comentário
  // equivalente em app/api/v1/webhooks/waha/[token]/route.ts).
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, organization_id")
      .eq("webhook_path_token", token)
      .eq("provider", CHANNEL_PROVIDER_EVOLUTION);
  const { data: session, error: sessErr } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );

  if (sessErr) return fail("internal_error", sessErr.message, 500, { requestId });
  if (!session) return fail("not_found", "unknown webhook token", 404, { requestId });

  const event = parseEvolutionWebhook(parsed);
  try {
    await dispatchEvolutionEvent(admin, session, event, requestId);
  } catch (err) {
    console.error("[evolution.webhook] handler failed", err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
