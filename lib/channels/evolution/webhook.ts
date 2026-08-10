/**
 * Parser PURO do webhook da Evolution API — sem I/O, testável sem rede/DB.
 * Mesmo padrão de `lib/channels/zernio/webhook.ts`: separa "entender o
 * payload" de "gravar no banco" (isso fica em `ingest.ts`, ao lado).
 *
 * ⚠️ NÃO MEDIDO CONTRA UM PAYLOAD REAL AINDA. O formato abaixo segue a doc
 * pública da Evolution API v2 (`messages.upsert`/`connection.update`,
 * estrutura Baileys padrão — `key.remoteJid`/`key.fromMe`/`key.id`,
 * `message.conversation`, `pushName`, `messageTimestamp`). Confirme contra um
 * payload de verdade da sua instância antes de considerar isto pronto — ver
 * aviso equivalente em `lib/evolution/client.ts`.
 *
 * Autenticação: a Evolution não assina webhook por padrão (diferente do WAHA
 * — HMAC SHA512 — e do Zernio — HMAC SHA256). A defesa é o token opaco na
 * própria URL (`webhook_path_token`, mesma coluna que os outros canais já
 * usam) — verificado pelo route handler ao resolver a sessão pelo token, não
 * por este módulo.
 */

export interface EvolutionMessageEvent {
  kind: "message";
  externalId: string;
  /** Só dígitos — grupo (`@g.us`) é descartado antes de chegar aqui. */
  fromPhone: string;
  fromMe: boolean;
  body: string | null;
  mediaUrl: string | null;
  pushName: string | null;
  timestampMs: number;
}

export interface EvolutionConnectionEvent {
  kind: "connection_update";
  /** `open` | `connecting` | `close` — vocabulário cru da Evolution. */
  state: string;
}

export type EvolutionEvent = EvolutionMessageEvent | EvolutionConnectionEvent | null;

interface RawKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
}

interface RawMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { url?: string; caption?: string };
  videoMessage?: { url?: string; caption?: string };
  audioMessage?: { url?: string };
  documentMessage?: { url?: string };
}

interface RawMessageData {
  key?: RawKey;
  pushName?: string;
  message?: RawMessageContent;
  messageTimestamp?: number;
}

interface RawConnectionData {
  state?: string;
}

interface RawWebhookBody {
  event?: string;
  instance?: string;
  data?: RawMessageData | RawConnectionData;
}

function bodyOf(msg: RawMessageContent | undefined): string | null {
  if (!msg) return null;
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    null
  );
}

function mediaUrlOf(msg: RawMessageContent | undefined): string | null {
  if (!msg) return null;
  return msg.imageMessage?.url ?? msg.videoMessage?.url ?? msg.audioMessage?.url ?? msg.documentMessage?.url ?? null;
}

/**
 * `5511999999999@s.whatsapp.net` → `5511999999999`. Grupo (`@g.us`) e
 * qualquer outro sufixo devolvem `null` — mesma decisão de `resolveRecipient`
 * (`lib/channels/adapters/evolution.ts`): formato de grupo não confirmado.
 */
function phoneFromRemoteJid(remoteJid: string | undefined): string | null {
  if (!remoteJid) return null;
  if (!remoteJid.endsWith("@s.whatsapp.net")) return null;
  const digits = remoteJid.slice(0, remoteJid.indexOf("@")).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function parseEvolutionWebhook(raw: unknown): EvolutionEvent {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as RawWebhookBody;

  if (body.event === "connection.update") {
    const data = body.data as RawConnectionData | undefined;
    if (!data?.state) return null;
    return { kind: "connection_update", state: data.state };
  }

  if (body.event === "messages.upsert") {
    const data = body.data as RawMessageData | undefined;
    if (!data?.key?.id) return null;
    const fromPhone = phoneFromRemoteJid(data.key.remoteJid);
    if (!fromPhone) return null; // grupo ou formato não reconhecido — descarta

    const text = bodyOf(data.message);
    const media = mediaUrlOf(data.message);
    if (!text && !media) return null; // evento sem conteúdo (reação, presença…)

    return {
      kind: "message",
      externalId: data.key.id,
      fromPhone,
      fromMe: data.key.fromMe ?? false,
      body: text,
      mediaUrl: media,
      pushName: data.pushName ?? null,
      timestampMs: data.messageTimestamp ? data.messageTimestamp * 1000 : Date.now(),
    };
  }

  return null;
}
