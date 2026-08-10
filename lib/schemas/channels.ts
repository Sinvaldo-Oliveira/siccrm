import { z } from "zod";

/**
 * Body para conectar um novo canal WhatsApp. `display_name` é opcional —
 * um rótulo amigável ("Vendas", "Suporte") que o transporte sobrescreve com o
 * nome do perfil quando a sessão fica WORKING.
 *
 * `provider` é uma STRING solta de propósito — não um enum aqui. A lista de
 * providers válidos (e quais deles sabem parear por QR) é conhecimento do
 * seam (`lib/channels/`), não deste schema; validar contra uma lista
 * duplicada aqui seria o `if (provider === ...)` que a doutrina de canal
 * proíbe fora de `lib/channels/`. A rota resolve via `getAdapter()`, que já
 * falha fechado para provider desconhecido.
 */
export const createChannelSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  provider: z.string().trim().min(1).max(40).optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

/** Status canônicos de sessão (WAHA + DB CHECK constraint). */
export const CHANNEL_STATUSES = [
  "STARTING",
  "SCAN_QR_CODE",
  "WORKING",
  "STOPPED",
  "FAILED",
] as const;

export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export function isChannelStatus(v: string): v is ChannelStatus {
  return (CHANNEL_STATUSES as readonly string[]).includes(v);
}
