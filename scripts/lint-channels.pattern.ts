/**
 * O padrão que reconhece "nome de provider" para o invariante 1 da doutrina de
 * restrição de canal (`docs/doctrine/restricao-de-canal.md`).
 *
 * Mora num módulo separado de `lint-channels.ts` por um motivo só: o script é
 * uma casca que varre o disco e chama `process.exit` no topo do módulo, então
 * importá-lo de um teste RODARIA o lint. Sem separar, o mecanismo do
 * reconhecimento fica sem como ser vigiado — e foi exatamente o que deixou o
 * furo abaixo viver.
 *
 * ─── O furo (issue #118) ────────────────────────────────────────────────────
 *
 * A primeira versão era `/\b(waha|WAHA|meta_cloud|graph\.facebook\.com)\b/`.
 * `_` é *word character* em regex, então `\b` NÃO fecha entre `WAHA` e `_`:
 * `WAHA_API_KEY` e `waha_session_name` — os nomes de provider mais comuns do
 * código — passavam invisíveis pela catraca, que está no `gov:verify` e é
 * catraca de merge. Uma catraca com furo é pior que catraca nenhuma: o verde
 * afirma que a doutrina está sendo respeitada.
 *
 * ─── Por que DUAS fronteiras, e não uma ─────────────────────────────────────
 *
 * Um provider vira identificador em TypeScript de dois jeitos, e cada um pede
 * uma fronteira diferente. Uma regex só não expressa os dois sem virar ilegível
 * ou frouxa:
 *
 *   `waha_session_name`, `WAHA_API_KEY`, `@/lib/waha/x`  → separador não-alfanumérico
 *   `WahaClient`, `createWahaSession`                    → transição de caixa
 *
 * Consertar só a primeira deixaria a segunda como álibi para o próximo caso —
 * é o mesmo furo (uma grafia do provider que a catraca não vê), na outra
 * dimensão. Medido na main de 2026-08-05: a regra PascalCase custa **zero**
 * arquivo ofensor a mais (hoje todo arquivo que a tem também importa de
 * `lib/waha/`), então fechar a classe inteira aqui não cria dívida nova.
 */

/**
 * Grafia separada por não-alfanumérico: `waha`, `WAHA_API_KEY`,
 * `waha_session_name`, `lib/waha/client`, `meta_cloud`, `graph.facebook.com`,
 * `evolution_api`.
 *
 * A fronteira é "não colado em alfanumérico" — deixa `_`, `/`, `.` e `-` serem
 * separadores de verdade (que `\b` não deixava) e continua ignorando `wahax` /
 * `xwaha`, onde `waha` é pedaço de outra palavra e não menção ao provider.
 *
 * ⚠️ O quarto provider é `evolution_api`, NUNCA o token solto `evolution`: o
 * repo já tem uma feature sem relação nenhuma com canal (`app/app/ai/evolution/`,
 * o Painel de Evolução do harness de IA — `EvolutionClient`, imports
 * `lib/ai/evolution/*`) que usa essa palavra em path e identificador. Medido
 * ao adicionar esta linha: `evolution` sozinho (SEPARADO, sem PASCAL) já
 * acertava esses arquivos via `"@/lib/ai/evolution/aggregate"` e
 * `/api/v1/ai/evolution`. `evolution_api` não colide com nenhum deles.
 */
const SEPARADO =
  /(?<![a-zA-Z0-9])(waha|meta_cloud|zernio|evolution_api|graph\.facebook\.com)(?![a-zA-Z0-9])/i;

/**
 * Grafia PascalCase dentro de identificador: `WahaClient`,
 * `WahaChannelAdapter`, `createWahaSession`.
 *
 * Case-SENSITIVE de propósito: é a transição de caixa que marca a fronteira do
 * segmento. Não seguido de minúscula/dígito exclui `Wahalla` — onde `Waha` é
 * começo de outra palavra, não segmento próprio.
 *
 * `Evolution` sozinho fica DE FORA da lista pelo mesmo motivo do `SEPARADO`
 * acima (colide com `EvolutionClient`/`EvolutionPage`, feature não
 * relacionada) — mesma decisão que já excluía `Meta` sozinho (só entra como
 * `meta_cloud`, nunca PascalCase bare, porque "Meta" também é palavra comum
 * demais para casar sem ruído). `EvolutionApi` seria o par PascalCase certo
 * se um dia aparecer um `EvolutionApiClient`/`EvolutionApiAdapter` fora de
 * `lib/channels/`; hoje nenhum identificador do canal usa essa forma (o
 * código usa `evolutionAdapter`/`EvolutionClient` — este último por acaso
 * TAMBÉM colidindo de nome com a feature não relacionada, sem colidir de
 * REGEX porque PASCAL não lista "Evolution").
 */
const PASCAL = /(Waha|Zernio)(?![a-z0-9])/;

/** Um trecho de código/prosa nomeia um provider de canal? */
export function nomeiaProvider(texto: string): boolean {
  return SEPARADO.test(texto) || PASCAL.test(texto);
}

/** Exportadas para o teste de fronteira poder vigiar cada uma isoladamente. */
export const PADROES = { SEPARADO, PASCAL } as const;
