/**
 * GET /api/v1/channel-sessions/[id]/qr — proxy do QR de UM canal específico.
 *
 * Como o onboarding, faz proxy do transporte para o browser poder
 * <img src="..." /> sem expor a API key — mas resolve a sessão por `id`
 * (multi-número), não pelo nome derivado do org. organization_id vem da
 * sessão autenticada. Motor (`provider`) resolvido pelo seam
 * (`getAdapter(...).getQrCode`) — esta rota não conhece o nome de nenhum
 * transporte, só orquestra estado (arquivado, sem sessão, não configurado).
 *
 * Canal EXCLUÍDO (arquivado) é recusado aqui, e não lá no transporte. Escanear
 * um QR é o ato que RELIGA um número: se ele aparecer para um canal
 * arquivado, o operador pareia o aparelho e a linha continua arquivada — o
 * mesmo "vivo e surdo" que a rota de reconectar recusa, só que consumado no
 * celular, fora do nosso alcance. Quem resolve um canal para religá-lo decide
 * sobre `archived_at` — as três rotas irmãs (conectar oficial, reconectar,
 * retomar o onboarding) decidem, esta faltava.
 *
 * Canal OFICIAL (meta_cloud) e BSP (zernio) também não passam daqui: não
 * pareiam por QR — `adapter.getQrCode` é `undefined` para os dois.
 */
import { NextResponse } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import {
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new NextResponse(null, { status: 403 });

  const supabase = await createClient();
  const buscar = (colunas: string) =>
    supabase
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .maybeSingle();
  const COLUNAS =
    "provider, waha_session_name, meta_phone_number_id, zernio_account_id, evolution_instance_name";
  // Tolerante à coluna ausente: num clone sem a migration 0106 nada está
  // arquivado, e exigir a coluna aqui apagaria o QR de quem está pareando agora
  // — o passo mais frágil da primeira instalação.
  const { data: sessionRaw } = await queryTolerantToMissingArchived(
    () => buscar(`${COLUNAS}, ${ARCHIVED_AT}`),
    () => buscar(COLUNAS),
  );
  const session = sessionRaw as
    | ({
        provider: ChannelProvider | null;
        waha_session_name: string | null;
        meta_phone_number_id: string | null;
        zernio_account_id: string | null;
        evolution_instance_name: string | null;
        archived_at?: string | null;
      })
    | null;
  if (!session) return new NextResponse(null, { status: 404 });
  // 409, não 404: o canal ESTÁ na organização — foi excluído. O corpo é vazio
  // porque quem consome isto é um <img>; o cabeçalho é para quem depura.
  if (session.archived_at) {
    return new NextResponse(null, {
      status: 409,
      headers: { "x-channel-state": "archived" },
    });
  }

  const provider = session.provider ?? DEFAULT_CHANNEL_PROVIDER;
  const adapter = getAdapter(provider);
  if (!adapter.getQrCode) {
    return new NextResponse(null, {
      status: 409,
      headers: { "x-channel-state": "no-session" },
    });
  }

  // A garantia de que a coluna certa está preenchida é do CHECK do banco
  // (`channel_sessions_provider_ref_check`), não de otimismo — mesma
  // confiança que `resolveSessionRef` já documenta.
  const sessionRef = resolveSessionRef(session as ChannelSessionRef);
  const result = await adapter.getQrCode({ sessionRef });
  if ("status" in result) {
    if (result.status === "unavailable") return new NextResponse(null, { status: 503 });
    return new NextResponse(null, {
      status: 409,
      headers: { "x-channel-state": result.status },
    });
  }

  return new NextResponse(new Uint8Array(result.image), {
    status: 200,
    headers: { "content-type": result.contentType, "cache-control": "no-store, max-age=0" },
  });
}
