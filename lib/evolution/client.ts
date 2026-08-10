/**
 * Cliente REST mínimo da Evolution API (gateway WhatsApp self-hosted, v2.x),
 * mesma forma do `lib/waha/client.ts` — um provider por instalação, sem
 * credencial por sessão (ver migration 0142).
 *
 * ⚠️ NÃO MEDIDO CONTRA UMA INSTÂNCIA REAL AINDA. Os endpoints/payloads abaixo
 * seguem a documentação pública da Evolution API v2 na época em que este
 * arquivo foi escrito — não uma instância de verdade, ao contrário do cliente
 * WAHA (que a doutrina do repo exige medir, não assumir — ver
 * `docs/doctrine/restricao-de-canal.md`). Antes de considerar isto pronto,
 * confirme cada endpoint/payload contra a instância real (URL base + API key)
 * e ajuste o que divergir. Pontos mais prováveis de mudar entre versões
 * menores da Evolution: o corpo de `sendText`/`sendMedia`, e o formato exato
 * do payload de `webhook/set`.
 *
 * Auth: header `apikey` (não `X-Api-Key` como o WAHA, não Bearer).
 */
import { classificarFalhaDeAlcance, explicarFalhaDeAlcance } from "@/lib/net/alcance";

export interface EvolutionQrResult {
  /** Data URL `data:image/png;base64,...` — pronta para virar Buffer de imagem. */
  base64?: string;
  status: "not_ready" | "already_connected" | "qr";
}

export class EvolutionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return { apikey: this.apiKey, "Content-Type": "application/json" };
  }

  /**
   * Cria a instância (idempotente na prática: a Evolution recusa nome
   * duplicado com 403/409 — tratado como sucesso, mesmo contrato do
   * `waha.startSession`: quem chama quer a instância existindo, não a
   * transição de criação).
   */
  async createInstance(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/create`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        instanceName: name,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });
    if (!res.ok && ![403, 409].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_create_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Estado da conexão: `open` (pareado), `connecting` (aguardando scan),
   * `close` (desconectado/nunca pareado).
   */
  async getConnectionState(name: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/instance/connectionState/${encodeURIComponent(name)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`evolution_state_${res.status}`);
    const body = (await res.json()) as { instance?: { state?: string } };
    return body.instance?.state ?? "close";
  }

  /**
   * QR code de pareamento. Devolve `already_connected` se o estado já é
   * `open`, `not_ready` se a Evolution ainda não gerou o código.
   */
  async getQrCode(name: string): Promise<EvolutionQrResult> {
    const state = await this.getConnectionState(name).catch(() => "close");
    if (state === "open") return { status: "already_connected" };

    const res = await fetch(`${this.baseUrl}/instance/connect/${encodeURIComponent(name)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`evolution_qr_${res.status}`);
    const body = (await res.json()) as { base64?: string; code?: string };
    if (!body.base64) return { status: "not_ready" };
    return { base64: body.base64, status: "qr" };
  }

  /** Idempotente: 404 (desconhecida) conta como sucesso. */
  async deleteInstance(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/delete/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_delete_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Configura o webhook da instância para apontar pra rota de ingestão do
   * CRM. `webhookUrl` já carrega o `webhook_path_token` opaco (mesmo padrão
   * de `webhooks/in/[token]`) — a Evolution não assina por padrão, então o
   * token na própria URL é a defesa, não HMAC.
   */
  async setWebhook(name: string, webhookUrl: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/webhook/set/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_webhook_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  async sendText(name: string, number: string, text: string): Promise<{ key?: { id?: string } }> {
    const res = await fetch(`${this.baseUrl}/message/sendText/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_send_${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as { key?: { id?: string } };
  }

  async sendMedia(
    name: string,
    number: string,
    plan: { mediatype: "image" | "video" | "document" | "audio"; media: string; caption?: string; fileName?: string },
  ): Promise<{ key?: { id?: string } }> {
    const res = await fetch(`${this.baseUrl}/message/sendMedia/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number, ...plan }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_send_${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as { key?: { id?: string } };
  }
}

/** Mesma tradução de erro de rede do WAHA — código compartilhado, mensagem própria. */
export function evolutionFriendlyError(erro: unknown): string {
  const falha = classificarFalhaDeAlcance(erro);
  if (falha !== "indeterminada") {
    return explicarFalhaDeAlcance(falha, "o WhatsApp (Evolution API)");
  }
  const msg = erro instanceof Error ? erro.message : String(erro ?? "unknown");
  return `Falha na comunicação com o WhatsApp (Evolution API): ${msg}`;
}

/**
 * Devolve um client configurado, ou `null` se o env não está preenchido —
 * mesmo contrato do `getWahaClient()`: ausência de config é NOOP, não erro.
 */
export function getEvolutionClient(): EvolutionClient | null {
  const url = process.env.EVOLUTION_API_BASE_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (!url || !key) return null;
  return new EvolutionClient(url, key);
}
