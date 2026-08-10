/**
 * De onde sai o identificador da sessão/número no provider.
 *
 * Esta é a pergunta que NÃO pode viver numa feature: com dois providers o
 * `sessionRef` vem de `waha_session_name` **ou** de `meta_phone_number_id`, e
 * quem escolher isso fora daqui vira o `if (provider === ...)` que o invariante
 * 1 da doutrina existe para proibir. O chamador pede o ref; a coluna é detalhe.
 *
 * O tipo é a tagged union que a migration 0087 já enforça no banco
 * (`channel_sessions_provider_ref_check`): a coluna do provider da vez é NOT
 * NULL, a do outro é NULL. Por isso o retorno é `string`, não `string | null` —
 * a garantia é do CHECK, não de otimismo.
 */
export type ChannelSessionRef =
  | { provider: "waha"; waha_session_name: string }
  | { provider: "meta_cloud"; meta_phone_number_id: string }
  | { provider: "zernio"; zernio_account_id: string }
  | { provider: "evolution_api"; evolution_instance_name: string };

/**
 * Colunas que um `select` do PostgREST precisa trazer para `resolveSessionRef`
 * funcionar. Fica aqui pelo mesmo motivo da função: a string do `select` também
 * nomeia coluna de provider, e ela some da feature junto com a decisão.
 */
export const CHANNEL_SESSION_REF_COLUMNS =
  "provider, waha_session_name, meta_phone_number_id, zernio_account_id, evolution_instance_name";

/**
 * Nome da coluna de referência de sessão de um provider que pareia por QR —
 * o que `POST /api/v1/channel-sessions` precisa saber
 * para gravar o nome de sessão gerado na coluna certa, sem a rota (fora de
 * `lib/channels/`) comparar strings de provider ela mesma. `null` para
 * provider que não pareia por QR (a rota trata como "não suportado").
 */
export function pairingRefColumn(
  provider: import("./types").ChannelProvider,
): "waha_session_name" | "evolution_instance_name" | null {
  switch (provider) {
    case "waha":
      return "waha_session_name";
    case "evolution_api":
      return "evolution_instance_name";
    default:
      return null;
  }
}

export function resolveSessionRef(session: ChannelSessionRef): string {
  switch (session.provider) {
    case "meta_cloud":
      return session.meta_phone_number_id;
    case "waha":
      return session.waha_session_name;
    // O `accountId` que o provider devolve ao conectar a WABA. NÃO é o
    // phone_number_id da Meta: quem intermedeia guarda o número por dentro e
    // endereça pelo id dele. Mandar o id da Meta aqui responde 404.
    case "zernio":
      return session.zernio_account_id;
    // Nome da instância na Evolution API — análogo a waha_session_name, gateway
    // diferente (container/credencial próprios, mesmo desenho BYO por instalação).
    case "evolution_api":
      return session.evolution_instance_name;
  }
}
