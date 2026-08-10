-- 0142 — vocabulário do quarto canal (Evolution API, gateway self-hosted
-- alternativo ao WAHA) em channel_sessions.
--
-- Mesmo padrão da 0131 (terceiro canal): o VOCABULÁRIO nasce antes do
-- transporte. Coluna nova, CHECKs redefinidos, adapter chega depois
-- encontrando o schema pronto.
--
-- Por que uma coluna NOVA e não reusar `waha_session_name`: os dois canais são
-- gateways NOWEB independentes (containers diferentes, credencial e API
-- diferentes) — o "nome de sessão" de um não tem relação com o "nome de
-- instância" do outro, e uma sessão nunca troca de provider sem trocar de id.
-- Nome ESPECÍFICO por decisão simétrica à da 0131 (que rejeitou reusar
-- `meta_phone_number_id` pelo mesmo motivo).
--
-- Diferente da 0131/0132: não há coluna de credencial cifrada por sessão. A
-- Evolution API deste canal é BYO self-hosted de UMA instalação (a mesma
-- decisão arquitetural do WAHA: `EVOLUTION_API_BASE_URL`/`EVOLUTION_API_KEY`
-- em env, compartilhados por toda a instalação) — não multi-conta por
-- organização como o BSP intermediário da 0132. Se o produto precisar de
-- Evolution BYO por organização no futuro, isso é uma migration própria, não
-- uma antecipação sem uso real hoje.
--
-- Idempotente e auto-curativa: a coluna nasce nullable, nenhuma linha
-- existente a viola; os dois CHECKs são RECRIADOS (drop + add) com o
-- vocabulário final de QUATRO providers — nunca `exception when
-- duplicate_object`, pelo mesmo motivo da 0131: um clone que já tem os três
-- providers anteriores ficaria com a constraint antiga e recusaria a sessão
-- Evolution em silêncio, com o `update.sh` passando verde.
--
-- Nenhum dado a deduplicar antes das constraints: toda linha pré-existente tem
-- provider 'waha', 'meta_cloud' ou 'zernio' e já satisfaz o ramo
-- correspondente.

alter table public.channel_sessions
  add column if not exists evolution_instance_name text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'evolution_api'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'         and waha_session_name       is not null) or
    (provider = 'meta_cloud'   and meta_phone_number_id    is not null) or
    (provider = 'zernio'       and zernio_account_id       is not null) or
    (provider = 'evolution_api' and evolution_instance_name is not null)
  );

comment on column public.channel_sessions.evolution_instance_name is
  'Nome da instância na Evolution API (gateway self-hosted, BYO por instalação via EVOLUTION_API_BASE_URL/EVOLUTION_API_KEY). Análogo a waha_session_name, provider diferente. Espelhado em lib/channels/session-ref.ts.';
