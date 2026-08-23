import type {
  Agent,
  WalletInfo,
  FundResult,
  PolicyInput,
  PolicyResult,
  EvaluationInput,
  EvaluationResult,
  CallToolInput,
  CallToolResult,
  HireAgentInput,
  HireAgentResult,
  SessionInfo,
  OverviewStats,
  StreamEventHandler,
} from "./types.js";
import type {
  PaymentDTO,
  TimelineEvent,
  StreamEvent,
  SimulationResult,
} from "@kron/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface KronClientConfig {
  /** Base URL of the KRON API (e.g. "http://localhost:8787"). */
  apiUrl: string;
  /** Admin/operator email for authentication. */
  email?: string;
  /** Admin/operator password. */
  password?: string;
  /**
   * Programmatic agent API key (sent as `Authorization: Bearer <key>`).
   * Takes precedence over session-based login — create one via the API keys
   * endpoint and bind it to the agent the SDK is operating.
   */
  apiKey?: string;
  /** Optional custom fetch implementation. */
  fetch?: typeof fetch;
}

export class KronError extends Error {
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "KronError";
    this.status = status;
    this.body = body;
  }
}

/**
 * KRON Client — Official TypeScript SDK for interacting with KRON's
 * policy-enforced economic runtime for AI agents on Algorand.
 */
export class KronClient {
  private readonly baseUrl: string;
  private readonly email?: string;
  private readonly password?: string;
  private readonly apiKey?: string;
  private cookie = "";
  private readonly customFetch: typeof fetch;
  private mcp: { client: Client; transport: StreamableHTTPClientTransport } | null = null;

  constructor(config: KronClientConfig) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.email = config.email;
    this.password = config.password;
    this.apiKey = config.apiKey;
    this.customFetch = config.fetch ?? fetch;
  }

  /* ------------------------------------------------------------------ */
  /* Internal HTTP helpers                                               */
  /* ------------------------------------------------------------------ */

  private async rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.customFetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new KronError(
        `Cannot reach KRON API at ${this.baseUrl} (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.apiKey) {
      headers.set("authorization", `Bearer ${this.apiKey}`);
    } else if (this.cookie) {
      headers.set("cookie", this.cookie);
    }
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const res = await this.rawRequest(path, { ...init, headers, credentials: "include" });

    // Handle session cookie from responses
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const sid = setCookie.split(";")[0];
      if (sid) this.cookie = sid;
    }

    if (res.status === 204) return undefined as T;

    // Retry on transient 429/502/503/504 with exponential backoff (per plan)
    if ([429, 502, 503, 504].includes(res.status) && attempt < 2) {
      const delay = 250 * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
      return this.request<T>(path, init, attempt + 1);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: unknown }).error)
          : typeof data === "string"
            ? data
            : `HTTP ${res.status}`;
      throw new KronError(`KRON request failed (${res.status}): ${msg}`, res.status, data);
    }

    return data as T;
  }

  /* ------------------------------------------------------------------ */
  /* Authentication                                                      */
  /* ------------------------------------------------------------------ */

  /** Authenticate with email & password (not needed when configured with an API key). */
  async login(email?: string, password?: string): Promise<{ user: { id: string; email: string; role: string } }> {
    if (this.apiKey) {
      throw new KronError("This client is configured with an API key — login() is not required");
    }
    const e = email ?? this.email;
    const p = password ?? this.password;
    if (!e || !p) {
      throw new KronError("Login requires email and password");
    }
    const res = await this.request<{ user: { id: string; email: string; role: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: e, password: p }),
    });
    return res;
  }

  /** Logout current session. */
  async logout(): Promise<void> {
    await this.request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
    this.cookie = "";
  }

  /* ------------------------------------------------------------------ */
  /* Agents                                                              */
  /* ------------------------------------------------------------------ */

  /** List all registered agents. */
  async listAgents(): Promise<Agent[]> {
    const res = await this.request<{ agents: Agent[] }>("/api/agents");
    return res.agents;
  }

  /** Get agent details by ID. */
  async getAgent(agentId: string): Promise<Agent> {
    const res = await this.request<{ agent: Agent }>(`/api/agents/${encodeURIComponent(agentId)}`);
    return res.agent;
  }

  /** Create a new agent with a dedicated Algorand wallet and default policy. */
  async createAgent(name: string, description?: string): Promise<Agent> {
    const res = await this.request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    return res.agent;
  }

  /* ------------------------------------------------------------------ */
  /* Wallets                                                             */
  /* ------------------------------------------------------------------ */

  /** Top up an agent's dedicated wallet. */
  async fundWallet(agentId: string, amountAlgo?: number): Promise<FundResult> {
    return this.request<FundResult>(
      `/api/agents/${encodeURIComponent(agentId)}/wallet/fund`,
      { method: "POST", body: JSON.stringify({ amountAlgo }) },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Policy Management                                                   */
  /* ------------------------------------------------------------------ */

  /** Get the active policy for an agent. */
  async getPolicy(agentId: string): Promise<PolicyResult> {
    const res = await this.request<{ policy: PolicyResult }>(`/api/agents/${encodeURIComponent(agentId)}/policy`);
    return res.policy;
  }

  /** Update an agent's policy (creates a new version and activates it). */
  async setPolicy(agentId: string, policy: PolicyInput): Promise<PolicyResult> {
    const res = await this.request<{ policy: PolicyResult }>(
      `/api/agents/${encodeURIComponent(agentId)}/policy`,
      { method: "PUT", body: JSON.stringify(policy) },
    );
    return res.policy;
  }

  /** Get version history of policies for an agent. */
  async getPolicyHistory(agentId: string): Promise<PolicyResult[]> {
    const res = await this.request<{ history: PolicyResult[] }>(
      `/api/agents/${encodeURIComponent(agentId)}/policy/history`,
    );
    return res.history;
  }

  /** Activate a previous policy version. */
  async activatePolicy(agentId: string, version: number): Promise<PolicyResult> {
    const res = await this.request<{ policy: PolicyResult }>(
      `/api/agents/${encodeURIComponent(agentId)}/policy/activate`,
      { method: "POST", body: JSON.stringify({ version }) },
    );
    return res.policy;
  }

  /** Simulate a draft policy against historical transactions. */
  async simulatePolicy(
    agentId: string,
    draft: PolicyInput,
    lookbackTransactions = 100,
  ): Promise<SimulationResult> {
    const res = await this.request<{ result: SimulationResult }>(
      `/api/agents/${encodeURIComponent(agentId)}/policy/simulate`,
      { method: "POST", body: JSON.stringify({ draft, lookbackTransactions }) },
    );
    return res.result;
  }

  /** Dry-run evaluate a payment against the agent's current policy without moving money. */
  async evaluatePayment(agentId: string, input: EvaluationInput): Promise<EvaluationResult> {
    return this.request<EvaluationResult>(
      `/api/agents/${encodeURIComponent(agentId)}/evaluate`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Sessions                                                            */
  /* ------------------------------------------------------------------ */

  /** Start a new task session for an agent. */
  async startSession(agentId: string, task?: string): Promise<SessionInfo> {
    const res = await this.request<{ session: SessionInfo }>(
      `/api/agents/${encodeURIComponent(agentId)}/sessions`,
      { method: "POST", body: JSON.stringify({ task }) },
    );
    return res.session;
  }

  /** List sessions for an agent. */
  async listSessions(agentId: string): Promise<SessionInfo[]> {
    const res = await this.request<{ sessions: SessionInfo[] }>(
      `/api/agents/${encodeURIComponent(agentId)}/sessions`,
    );
    return res.sessions;
  }

  /** Get the real-time event timeline for a session. */
  async getTimeline(sessionId: string): Promise<TimelineEvent[]> {
    const res = await this.request<{ events: TimelineEvent[] }>(
      `/api/analytics/timeline/${encodeURIComponent(sessionId)}`,
    );
    return res.events;
  }

  /* ------------------------------------------------------------------ */
  /* Paid Tool Execution                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Call a paid MCP tool through KRON.
   * KRON automatically intercepts 402, evaluates policy, signs Algorand payment,
   * anchors policy on-chain, and delivers the paid result.
   *
   * Uses the MCP SDK client (streamable HTTP) with a lazily-created, reused
   * session so repeated paid calls in an agent loop share one connection.
   */
  async callPaidTool(input: CallToolInput): Promise<CallToolResult> {
    const client = await this.ensureMcpClient();
    let raw: unknown;
    try {
      raw = await client.callTool({
        name: "kron.call_tool",
        arguments: {
          tool: input.tool,
          serverId: input.serverId,
          arguments: input.arguments ?? {},
          agentId: input.agentId,
          sessionId: input.sessionId,
        },
      });
    } catch (err) {
      throw new KronError(
        `kron.call_tool failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return parseCallToolResult(raw);
  }

  /** Close the MCP connection (optional cleanup). */
  async close(): Promise<void> {
    if (!this.mcp) return;
    try {
      await this.mcp.transport.terminateSession();
    } catch {
      /* session may already be closed */
    }
    try {
      await this.mcp.client.close();
    } catch {
      /* ignore */
    }
    this.mcp = null;
  }

  private async ensureMcpClient(): Promise<Client> {
    if (this.mcp) return this.mcp.client;
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", this.baseUrl), {
      requestInit: { headers },
    });
    const client = new Client({ name: "kron-sdk", version: "1.0.0" });
    try {
      await client.connect(transport);
    } catch (err) {
      throw new KronError(
        `Could not connect to KRON MCP at ${this.baseUrl}/mcp: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.mcp = { client, transport };
    return client;
  }

  /* ------------------------------------------------------------------ */
  /* Agent-to-Agent (A2A) Autonomous Hiring                              */
  /* ------------------------------------------------------------------ */

  /**
   * Have one agent hire another agent for a subtask with autonomous on-chain compensation.
   * KRON evaluates the hiring agent's spending policy and signs an on-chain transfer to the target agent.
   */
  async hireAgent(input: HireAgentInput): Promise<HireAgentResult> {
    return this.request<HireAgentResult>(
      `/api/agents/${encodeURIComponent(input.agentId)}/hire`,
      {
        method: "POST",
        body: JSON.stringify({
          targetAgentId: input.targetAgentId,
          task: input.task,
          amountAlgo: input.amountAlgo,
          sessionId: input.sessionId,
        }),
      },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Payments & Escalations                                              */
  /* ------------------------------------------------------------------ */

  /** List payments with optional filters. */
  async listPayments(params?: { agentId?: string; status?: string; limit?: string }): Promise<PaymentDTO[]> {
    const q = new URLSearchParams();
    if (params?.agentId) q.set("agentId", params.agentId);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", params.limit);
    const qs = q.toString();
    const res = await this.request<{ payments: PaymentDTO[] }>(`/api/payments${qs ? `?${qs}` : ""}`);
    return res.payments;
  }

  /** Approve or deny an escalated payment. */
  async decideEscalation(escalationId: string, approve: boolean): Promise<{ approved: boolean }> {
    return this.request<{ approved: boolean }>(
      `/api/escalations/${encodeURIComponent(escalationId)}/decide`,
      { method: "POST", body: JSON.stringify({ approve }) },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Analytics                                                           */
  /* ------------------------------------------------------------------ */

  /** Get high-level overview metrics across all agents and payments. */
  async getOverview(): Promise<OverviewStats> {
    const res = await this.request<{ overview: OverviewStats }>("/api/analytics/overview");
    return res.overview;
  }

  /* ------------------------------------------------------------------ */
  /* Real-time Events                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Subscribe to live SSE events from KRON.
   * Returns an unsubscribe function.
   */
  subscribeEvents(handler: StreamEventHandler): () => void {
    if (typeof EventSource === "undefined") {
      throw new KronError("EventSource is not supported in this environment");
    }
    const es = new EventSource(`${this.baseUrl}/api/events`, { withCredentials: true });
    const eventTypes = [
      "hello",
      "session.updated",
      "agent.updated",
      "timeline",
      "tool.call",
      "payment.created",
      "payment.updated",
      "decision",
      "policy.updated",
      "wallet.updated",
      "mcp.health",
      "audit",
    ];

    const listener = (event: Event) => {
      try {
        const e = event as MessageEvent;
        const parsed = JSON.parse(e.data) as StreamEvent;
        handler(parsed);
      } catch {
        /* ignore parse errors */
      }
    };

    for (const t of eventTypes) {
      es.addEventListener(t, listener);
    }

    return () => {
      for (const t of eventTypes) {
        es.removeEventListener(t, listener);
      }
      es.close();
    };
  }
}

/** Normalize an MCP `tools/call` result into the SDK's {@link CallToolResult}. */
function parseCallToolResult(raw: unknown): CallToolResult {
  const r = raw as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | null;
  const content = (r?.content ?? []).map((c) => ({ type: c.type, text: c.text }));

  if (r?.isError) {
    const msg = content.find((c) => typeof c.text === "string")?.text ?? JSON.stringify(raw);
    return {
      ok: false,
      isPaid: false,
      content,
      error: msg.replace(/^ERROR:\s*/, ""),
    };
  }

  const first = content.find((c) => typeof c.text === "string")?.text;
  if (first) {
    try {
      const parsed = JSON.parse(first) as Partial<CallToolResult>;
      if (parsed && typeof parsed === "object" && "ok" in parsed) {
        return { content, ...parsed } as CallToolResult;
      }
    } catch {
      // not JSON — fall through to the raw content result
    }
  }

  return { ok: true, isPaid: false, content };
}
