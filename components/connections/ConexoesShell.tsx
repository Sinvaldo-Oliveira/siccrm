"use client";
import { useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CanalOficialClient } from "./CanalOficialClient";
import { ConnectionsClient } from "./ConnectionsClient";
import { TemplatesClient } from "./TemplatesClient";

/**
 * Conexões — TODOS os canais em um lugar só.
 *
 * ─── Por que isto existe ────────────────────────────────────────────────────
 * Conectar o número por QR ficava aqui; conectar o número OFICIAL ficava em
 * Configurações; os templates, que só existem por causa do canal oficial, ficavam
 * numa terceira tela. Três lugares para uma coisa só — e o usuário precisava saber
 * de antemão que a resposta para "conectar meu WhatsApp" dependia de QUAL WhatsApp.
 *
 * A pergunta que a tela responde é "por onde meu negócio fala com o cliente". A
 * resposta é uma lista de canais, não um mapa do nosso código: quem instala não
 * sabe (nem deve saber) que um passa por QR e o outro por credencial da Meta.
 *
 * Templates entram como sub-aba do canal oficial, e não como item de topo, porque
 * eles NÃO existem fora dele: num canal por QR não há template a aprovar. Promovê-los
 * a item de primeiro nível sugeriria uma escolha que não existe.
 *
 * ─── A aba vive na URL ──────────────────────────────────────────────────────
 * `?aba=` e `?sub=` em vez de estado só em memória: as rotas antigas
 * (`/app/settings/canal-oficial`, `/app/settings/templates`) redirecionam para cá
 * apontando a aba certa, e um link colado no chat abre onde deveria. Aba que só
 * existe em `useState` transforma todo link salvo em "abre e procura de novo".
 */
export function ConexoesShell({
  wahaConfigured,
  evolutionConfigured,
}: {
  wahaConfigured: boolean;
  evolutionConfigured: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const aba = params.get("aba") === "oficial" ? "oficial" : "numeros";
  const sub = params.get("sub") === "templates" ? "templates" : "conexao";

  const irPara = (proximaAba: string, proximaSub?: string): void => {
    const q = new URLSearchParams();
    if (proximaAba !== "numeros") q.set("aba", proximaAba);
    if (proximaSub && proximaSub !== "conexao") q.set("sub", proximaSub);
    const qs = q.toString();
    // `scroll: false`: trocar de aba não é navegar para outra página; jogar o
    // usuário para o topo a cada clique faz a tela parecer que recarregou.
    router.replace(qs ? `/app/connections?${qs}` : "/app/connections", { scroll: false });
  };

  return (
    <Tabs value={aba} onValueChange={(v) => irPara(v, sub)} className="flex flex-col gap-4">
      <TabsList>
        {/* Rótulos pelo que o usuário RECONHECE, não pelo nome técnico do motor por
            trás: ele sabe se leu um QR ou se tem conta na Meta; a sigla do provedor
            não diz nada a quem instalou o sistema para vender.

            Este comentário já citou a sigla como exemplo — e o `lint:channels`
            reprovou, porque o regex da doutrina não distingue prosa de código
            (limitação registrada no próprio `scripts/lint-channels.ts`). Reescrever
            a frase custou menos que abrir exceção no gate, e o gate continua
            estrito: o dia em que alguém escrever o nome do provider aqui DE VERDADE,
            ele reprova igual. */}
        <TabsTrigger value="numeros">Números por QR</TabsTrigger>
        <TabsTrigger value="oficial">API Oficial (Meta)</TabsTrigger>
      </TabsList>

      <TabsContent value="numeros" className="mt-0">
        <ConnectionsClient wahaConfigured={wahaConfigured} evolutionConfigured={evolutionConfigured} />
      </TabsContent>

      <TabsContent value="oficial" className="mt-0">
        <Tabs value={sub} onValueChange={(v) => irPara("oficial", v)} className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="conexao">Conexão</TabsTrigger>
            {/* "Templates da Meta", não "Templates": a barra lateral já tem um item
                com esse nome que significa OUTRA coisa — respostas rápidas salvas
                pelo atendente (`/app/templates`). Dois conceitos com o mesmo rótulo
                fazem o operador clicar no errado e concluir que a tela está quebrada.
                A colisão é anterior a esta mudança; o que dá para fazer aqui é não
                agravá-la. */}
            <TabsTrigger value="templates">Templates da Meta</TabsTrigger>
          </TabsList>
          <TabsContent value="conexao" className="mt-0">
            <CanalOficialClient />
          </TabsContent>
          <TabsContent value="templates" className="mt-0">
            <TemplatesClient />
          </TabsContent>
        </Tabs>
      </TabsContent>
    </Tabs>
  );
}
