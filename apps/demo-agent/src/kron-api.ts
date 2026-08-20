/**
 * Tiny fetch-based helper for the KRON admin REST API.
 * Logs in with the admin credentials and replays the `kron.sid` cookie.
 */

export interface AgentDTO {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  walletId: string | null;
  walletAddress: string | null;
  activePolicyId: string | null;
  activePolicyVersion: number | null;
  createdAt: string;
}

export interface SessionDTO {
  id: string;
  agentId: string;
  task: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface MCPToolDTO {
  id: string;
  name: string;
  description?: string | null;
}

export interface MCPServerDTO {
  id: string;
  name: string;
  url: string;
  transport: string;
  status: string;
  tools: MCPToolDTO[];
}

export interface PolicyConfig {
  id: string;
  version: number;
  perCallLimitAlgo?: number;
  recipientAllowlist: string[];
  serviceAllowlist: string[];
  unknownRecipient?: "block" | "escalate" | "allow";
  firstTimeService?: "block" | "escalate" | "allow";
}

export type RecipientAction = "block" | "escalate" | "allow";

export class KronApiError extends Error {
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "KronApiError";
    this.status = status;
    this.body = body;
  }
}

export class KronApi {
  private readonly base: string;
  private readonly email: string;
  private readonly password: string;
  private cookie = "";

  constructor(options: { base: string; email: string; password: string }) {
    this.base = options.base.replace(/\/+$/, "");
    this.email = options.email;
    this.password = options.password;
  }

  private async requestRaw(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.base}${path}`, init);
    } catch (err) {
      throw new KronApiError(
        `Cannot reach KRON API at ${this.base} — is it running? (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  async login(): Promise<void> {
    const res = await this.requestRaw("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
      redirect: "manual",
    });
    if (!res.ok) {
      throw new KronApiError(
        `Login failed (HTTP ${res.status}) — is the KRON API running at ${this.base}? Check KRON_API_URL / KRON_ADMIN_EMAIL / KRON_ADMIN_PASSWORD.`,
      );
    }
    const setCookie = res.headers.get("set-cookie") ?? "";
    const sid = setCookie.split(";")[0];
    if (!sid) {
      throw new KronApiError("Login succeeded but no kron.sid cookie was returned");
    }
    this.cookie = sid;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.cookie) throw new KronApiError("Not authenticated — call login() first");
    const headers = new Headers(init.headers);
    headers.set("cookie", this.cookie);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const res = await this.requestRaw(path, { ...init, headers });
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
      throw new KronApiError(`KRON API ${path} failed (HTTP ${res.status}): ${msg}`, res.status, data);
    }
    return data as T;
  }

  async listAgents(): Promise<AgentDTO[]> {
    const res = await this.request<{ agents: AgentDTO[] }>("/api/agents");
    return res.agents;
  }

  async createAgent(name: string, description?: string): Promise<AgentDTO> {
    const res = await this.request<{ agent: AgentDTO }>("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    return res.agent;
  }

  async startSession(agentId: string, task?: string): Promise<SessionDTO> {
    const res = await this.request<{ session: SessionDTO }>(
      `/api/agents/${encodeURIComponent(agentId)}/sessions`,
      { method: "POST", body: JSON.stringify({ task }) },
    );
    return res.session;
  }

  /** Top-up the agent wallet (server only sends ALGO when below its threshold). */
  async fundWallet(agentId: string, amountAlgo: number): Promise<{ address: string; balanceAlgo: number }> {
    return this.request<{ address: string; balanceAlgo: number }>(
      `/api/agents/${encodeURIComponent(agentId)}/wallet/fund`,
      { method: "POST", body: JSON.stringify({ amountAlgo }) },
    );
  }

  async listMcpServers(): Promise<MCPServerDTO[]> {
    const res = await this.request<{ servers: MCPServerDTO[] }>("/api/mcp/servers");
    return res.servers;
  }

  async createMcpServer(input: { name: string; url: string; transport: string }): Promise<MCPServerDTO> {
    const res = await this.request<{ server: MCPServerDTO }>("/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return res.server;
  }

  async testMcpServer(
    id: string,
  ): Promise<{ ok: boolean; latencyMs?: number | null; error?: string | null; tools: string[] }> {
    return this.request<{ ok: boolean; latencyMs?: number | null; error?: string | null; tools: string[] }>(
      `/api/mcp/servers/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    );
  }

  async getPolicy(agentId: string): Promise<PolicyConfig> {
    const res = await this.request<{ policy: PolicyConfig }>(`/api/agents/${encodeURIComponent(agentId)}/policy`);
    return res.policy;
  }

  async updatePolicy(
    agentId: string,
    update: {
      perCallLimitAlgo?: number;
      hardCeilingAlgo?: number;
      sessionBudgetAlgo?: number;
      dailyBudgetAlgo?: number;
      maxDailyPayments?: number;
      unknownRecipient?: RecipientAction;
      firstTimeService?: RecipientAction;
      recipientAllowlist?: string[];
      serviceAllowlist?: string[];
    },
  ): Promise<PolicyConfig> {
    const res = await this.request<{ policy: PolicyConfig }>(`/api/agents/${encodeURIComponent(agentId)}/policy`, {
      method: "PUT",
      body: JSON.stringify(update),
    });
    return res.policy;
  }

  async hireAgent(
    agentId: string,
    targetAgentId: string,
    task: string,
    amountAlgo: number,
  ): Promise<{
    ok: boolean;
    status: string;
    flow?: { txId?: string; payment?: { amountAlgo?: number; status?: string } };
    hiredAgent?: { id: string; name: string };
    taskResult?: string;
  }> {
    return this.request<{
      ok: boolean;
      status: string;
      flow?: { txId?: string; payment?: { amountAlgo?: number; status?: string } };
      hiredAgent?: { id: string; name: string };
      taskResult?: string;
    }>(`/api/agents/${encodeURIComponent(agentId)}/hire`, {
      method: "POST",
      body: JSON.stringify({ targetAgentId, task, amountAlgo }),
    });
  }
}