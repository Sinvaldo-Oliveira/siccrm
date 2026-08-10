/**
 * Adapter Evolution API — mesma forma do `waha.ts`: cada método delega ao
 * `lib/evolution/*` que faz o transporte. Nenhuma regra de negócio mora aqui
 * (ver `ChannelAdapter` em ../types).
 *
 * ⚠️ `resolveRecipient` só endereça chat individual (grupo devolve `null` de
 * propósito — ver comentário em `../capabilities.ts` sobre `groups: "none"`).
 */
import { evolutionFriendlyError, getEvolutionClient } from "@/lib/evolution/client";
import { env } from "@/lib/env";
import type { ChannelAdapter, OutboundEnvelope, RecipientInput } from "../types";

export const evolutionAdapter: ChannelAdapter = {
  provider: "evolution_api",

  resolveRecipient(input: RecipientInput): string | null {
    // Grupo: formato de endereço não confirmado contra a API real ainda —
    // devolver null é honesto (ver capabilities.ts, groups: "none").
    if (input.isGroup) return null;
    if (!input.phoneNumber) return null;
    const digits = input.phoneNumber.replace(/\D/g, "");
    return digits.length > 0 ? digits : null;
  },

  isConfigured(): boolean {
    return getEvolutionClient() !== null;
  },

  codes: {
    notConfigured: "evolution_not_configured",
    sendFailed: "evolution_error",
    unknownError: "evolution_unknown",
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const client = getEvolutionClient();
    // Sem env configurada é NOOP, não erro — mesmo contrato do WAHA: a UI
    // mostra o banner de "motor não configurado" em vez de uma exceção.
    if (!client) return { externalId: null };

    try {
      const res = envelope.media
        ? await client.sendMedia(envelope.sessionRef, envelope.to, {
            mediatype: mediaTypeOf(envelope),
            media: envelope.media.url,
            caption: envelope.media.caption ?? undefined,
            fileName: envelope.media.filename ?? undefined,
          })
        : await client.sendText(envelope.sessionRef, envelope.to, envelope.body ?? "");
      return { externalId: res.key?.id ?? null };
    } catch (err) {
      throw new Error(evolutionFriendlyError(err));
    }
  },

  // Diferente do outro motor self-hosted: este precisa que O APP registre o
  // webhook por instância — não há env de container apontando pra cá sozinho.
  async startPairing(input: {
    sessionRef: string;
    webhookPathToken: string;
  }): Promise<{ ok: boolean }> {
    const client = getEvolutionClient();
    if (!client) return { ok: false };
    await client.createInstance(input.sessionRef);
    const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/evolution/${input.webhookPathToken}`;
    await client.setWebhook(input.sessionRef, webhookUrl);
    return { ok: true };
  },

  async getQrCode(input: { sessionRef: string }) {
    const client = getEvolutionClient();
    if (!client) return { status: "unavailable" as const };

    const result = await client.getQrCode(input.sessionRef);
    if (result.status === "already_connected") return { status: "already_connected" as const };
    if (result.status === "not_ready" || !result.base64) return { status: "not_ready" as const };

    // `base64` chega como data URL (`data:image/png;base64,....`) — extrai só
    // o corpo antes de decodificar.
    const comma = result.base64.indexOf(",");
    const body = comma >= 0 ? result.base64.slice(comma + 1) : result.base64;
    const contentType = result.base64.startsWith("data:")
      ? result.base64.slice(5, result.base64.indexOf(";"))
      : "image/png";
    return { image: Buffer.from(body, "base64"), contentType };
  },

  // ⚠️ Vocabulário de estado (`open`/`connecting`/`close`) mapeado pro mesmo
  // `status` que os outros providers gravam — ver `dispatchEvolutionEvent` em
  // `lib/channels/evolution/ingest.ts`, mesma tabela. Telefone não incluído:
  // o formato em que a API devolve o número da instância não foi confirmado
  // ainda (mesmo aviso de `lib/evolution/client.ts`).
  async checkLiveStatus(input: { sessionRef: string }) {
    const client = getEvolutionClient();
    if (!client) return { status: null, phoneNumber: null };
    const STATE_MAP: Record<string, string> = {
      open: "WORKING",
      connecting: "SCAN_QR_CODE",
      close: "STOPPED",
    };
    try {
      const state = await client.getConnectionState(input.sessionRef);
      return { status: STATE_MAP[state] ?? null, phoneNumber: null };
    } catch {
      return { status: null, phoneNumber: null };
    }
  },
};

/** `kind` do envelope → `mediatype` que a Evolution espera. */
function mediaTypeOf(envelope: OutboundEnvelope): "image" | "video" | "document" | "audio" {
  switch (envelope.kind) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    default:
      return "document";
  }
}
