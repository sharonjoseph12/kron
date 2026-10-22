import type {
  ActionDecisionResult,
  ActionRequest,
  ActionSessionStateDTO,
  AgentDTO,
  AgentSessionDTO,
  AgentSpendRow,
  ApprovalDTO,
  AuditChainEntryDTO,
  AuditEntryDTO,
  AuditVerifyResult,
  BurnRate,
  CapabilityGrantDTO,
  DecisionSlice,
  DriftProofDTO,
  EnforcementReceiptDTO,
  MCPServerDTO,
  OverviewStats,
  PaymentDTO,
  PolicyConfig,
  PolicyEvaluation,
  PolicyUpdateInput,
  ProofPaneDTO,
  ReceiptVerifyResult,
  SimulationResult,
  SpendPoint,
  TimelineEvent,
} from "@kron/shared";

/** Base URL for the KRON API. Empty in dev so the Vite proxy is used. */
export const API_BASE = (import.meta.env.VITE_KRON_API_URL as string | undefined) ?? "";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  algorandAddress?: string | null;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });

export interface ExecutePaymentResultShape {
  status: string;
  payment: PaymentDTO;
  decision: string | null;
  reasons: string[];
  token: string | null;
  txId: string | null;
  escalationId: string | null;
}

export interface EscalationDTO {
  id: string;
  paymentId: string;
  decisionId: string | null;
  status: string;
  summary: string | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export const api = {
  // ---- auth ----
  me: () => get<{ user: User }>("/api/auth/me"),
  login: (email: string, password: string) => post<{ user: User }>("/api/auth/login", { email, password }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout", {}),

  // ---- pera wallet (sign-in with Algorand) ----
  peraChallenge: () =>
    post<{ nonce: string; issuedAt: string; expiresAt: string; origin: string }>(
      "/api/auth/pera/challenge",
      {},
    ),
  peraVerify: (input: { address: string; signature: string; nonce: string }) =>
    post<{ user: User }>("/api/auth/pera/verify", input),

  // ---- analytics ----
  getOverview: () => get<{ overview: OverviewStats }>("/api/analytics/overview"),
  getSpend: () => get<{ points: SpendPoint[] }>("/api/analytics/spend"),
  getDecisions: () => get<{ slices: DecisionSlice[] }>("/api/analytics/decisions"),
  getAgentsSpend: () => get<{ rows: AgentSpendRow[] }>("/api/analytics/agents-spend"),
  getBurnRate: () => get<{ burnRate: BurnRate }>("/api/analytics/burn-rate"),
  getContract: () =>
    get<{
      appId: number | null;
      deployed: boolean;
      network: string;
      globalState: {
        totalPayments: number;
        lastPolicyHash: string | null;
        lastAgentId: string | null;
        lastAmountMicro: number;
        emergencyStop: boolean;
      };
      settlements: number;
      createdAtRound: number;
    }>("/api/contract"),
  getTimeline: (sessionId: string) =>
    get<{ events: TimelineEvent[] }>(`/api/analytics/timeline/${encodeURIComponent(sessionId)}`),

  // ---- agents ----
  listAgents: () => get<{ agents: AgentDTO[] }>("/api/agents"),
  getAgent: (id: string) => get<{ agent: AgentDTO }>(`/api/agents/${encodeURIComponent(id)}`),
  createAgent: (input: { name: string; description?: string }) =>
    post<{ agent: AgentDTO }>("/api/agents", input),
  listSessions: (agentId: string) =>
    get<{ sessions: AgentSessionDTO[] }>(`/api/agents/${encodeURIComponent(agentId)}/sessions`),
  startSession: (agentId: string, task?: string) =>
    post<{ session: AgentSessionDTO }>(`/api/agents/${encodeURIComponent(agentId)}/sessions`, { task }),
  getPolicy: (agentId: string) =>
    get<{ policy: PolicyConfig }>(`/api/agents/${encodeURIComponent(agentId)}/policy`),
  getPolicyHistory: (agentId: string) =>
    get<{ history: PolicyConfig[] }>(`/api/agents/${encodeURIComponent(agentId)}/policy/history`),
  updatePolicy: (agentId: string, patch: PolicyUpdateInput) =>
    put<{ policy: PolicyConfig }>(`/api/agents/${encodeURIComponent(agentId)}/policy`, patch),
  activatePolicy: (agentId: string, version: number) =>
    post<{ policy: PolicyConfig }>(`/api/agents/${encodeURIComponent(agentId)}/policy/activate`, { version }),
  simulatePolicy: (agentId: string, draft: PolicyUpdateInput, lookbackTransactions?: number) =>
    post<{ result: SimulationResult }>(`/api/agents/${encodeURIComponent(agentId)}/policy/simulate`, {
      draft,
      lookbackTransactions,
    }),
  fundWallet: (agentId: string) =>
    post<{ address: string; balanceAlgo: number }>(`/api/agents/${encodeURIComponent(agentId)}/wallet/fund`, {}),
  evaluate: (
    agentId: string,
    input: { recipient: string; amountAlgo: number; service?: string; sessionId?: string },
  ) =>
    post<{ evaluation: PolicyEvaluation }>(
      `/api/agents/${encodeURIComponent(agentId)}/evaluate`,
      input,
    ),
  hireAgent: (
    agentId: string,
    input: { targetAgentId: string; task: string; amountAlgo: number; sessionId?: string },
  ) =>
    post<{ ok: boolean; status: string; flow?: any; hiredAgent?: { id: string; name: string }; taskResult?: string }>(
      `/api/agents/${encodeURIComponent(agentId)}/hire`,
      input,
    ),

  // ---- payments ----
  executePayment: (input: {
    agentId: string;
    sessionId: string;
    toolCallId: string;
    mcpServerId: string;
    toolName: string;
    service: string;
    resourceId: string;
    resourceName: string;
    recipient: string;
    amountAlgo: number;
    network?: string;
    clientRequestId?: string;
  }) => post<any>("/api/payments/execute", input),
  listPayments: (params?: { agentId?: string; status?: string; limit?: string }) => {
    const q = new URLSearchParams();
    if (params?.agentId) q.set("agentId", params.agentId);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", params.limit);
    const qs = q.toString();
    return get<{ payments: PaymentDTO[] }>(`/api/payments${qs ? `?${qs}` : ""}`);
  },
  getPayment: (id: string) =>
    get<{ payment: PaymentDTO; escalation: EscalationDTO | null }>(`/api/payments/${encodeURIComponent(id)}`),
  verifyPayment: (query: string) =>
    get<{
      verified: boolean;
      payment: PaymentDTO;
      agent: { id: string; name: string };
      onChainProof: {
        txId: string | null;
        appId: number | null;
        appCallTxId: string | null;
        policyHash: string | null;
        confirmedRound: number | null;
        network: string;
        policyVersion: number;
        verifiedOnLedger: boolean;
        statement: string;
      };
    }>(`/api/payments/verify/${encodeURIComponent(query)}`),
  decideEscalation: (escalationId: string, approve: boolean) =>
    post<{ approved: boolean; flow?: ExecutePaymentResultShape }>(
      `/api/escalations/${encodeURIComponent(escalationId)}/decide`,
      { approve },
    ),

  // ---- mcp ----
  listServers: () => get<{ servers: MCPServerDTO[] }>("/api/mcp/servers"),
  createServer: (input: { name: string; url: string; transport?: "streamable-http" | "sse"; authToken?: string }) =>
    post<{ server: MCPServerDTO }>("/api/mcp/servers", input),
  testServer: (id: string) =>
    post<{ ok: boolean; latencyMs?: number; error?: string | null; tools?: string[] }>(
      `/api/mcp/servers/${encodeURIComponent(id)}/test`,
      {},
    ),
  serverHealth: (id: string) =>
    get<{ status: string; ok: boolean; latencyMs?: number; error?: string | null; tools?: string[] }>(
      `/api/mcp/servers/${encodeURIComponent(id)}/health`,
    ),

  // ---- PS 2.1 control plane ----
  evaluateAction: (input: ActionRequest & { mode?: "kron" | "baseline" }) =>
    post<{ result: ActionDecisionResult }>("/api/actions/evaluate", input),
  listApprovals: (status = "pending") =>
    get<{ approvals: ApprovalDTO[] }>(`/api/approvals?status=${encodeURIComponent(status)}`),
  getApproval: (id: string) => get<{ approval: ApprovalDTO }>(`/api/approvals/${encodeURIComponent(id)}`),
  decideApproval: (
    id: string,
    input: { decision: "approve" | "reject"; target?: "safe" | "original"; actionHash?: string },
  ) =>
    post<{
      approval: ApprovalDTO;
      execution: { summary: string; affectedRows?: number } | null;
      proof: ProofPaneDTO;
      grantId?: string | null;
      receiptId?: string | null;
    }>(`/api/approvals/${encodeURIComponent(id)}/decide`, input),
  getProof: () => get<{ proof: ProofPaneDTO }>("/api/proof"),
  listGrants: (limit = 50) => get<{ grants: CapabilityGrantDTO[] }>(`/api/grants?limit=${limit}`),
  listReceipts: (limit = 50) => get<{ receipts: EnforcementReceiptDTO[] }>(`/api/receipts?limit=${limit}`),
  getReceipt: (id: string) => get<{ receipt: EnforcementReceiptDTO }>(`/api/receipts/${encodeURIComponent(id)}`),
  verifyReceipts: () => get<{ verification: ReceiptVerifyResult }>("/api/receipts/verify"),
  getControlSession: (sessionId: string, agentId: string) =>
    get<{ state: ActionSessionStateDTO }>(
      `/api/control/sessions/${encodeURIComponent(sessionId)}?agentId=${encodeURIComponent(agentId)}`,
    ),
  runScenario: (name: "hero" | "delete" | "baseline" | "drift" | "all", opts?: { autoApprove?: boolean; reset?: boolean }) =>
    post<{ scenarios: unknown[] }>("/api/demo/scenario", { name, ...opts }),
  runDrift: () => post<{ drift: DriftProofDTO }>("/api/demo/drift", {}),
  controlAudit: (limit = 100) => get<{ entries: AuditChainEntryDTO[] }>(`/api/control/audit?limit=${limit}`),
  verifyControlAudit: () => get<{ verification: AuditVerifyResult }>("/api/control/audit/verify"),
  tamperControlAudit: () => post<{ ok: boolean }>("/api/control/audit/tamper", {}),

  // ---- demo ----
  resetDemo: () => post<{ ok: boolean; message: string }>("/api/demo/reset", {}),
  demoStatus: () =>
    get<{ demoMode: boolean; network: string; agents: number; wallets: number; policies: number; payments: number; settlements: number }>(
      "/api/demo/status",
    ),

  // ---- audit ----
  listAudit: (params?: { limit?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", params.limit);
    const qs = q.toString();
    return get<{ entries: AuditEntryDTO[] }>(`/api/audit${qs ? `?${qs}` : ""}`);
  },
};