/**
 * KRON shared domain types — single source of truth for the whole platform.
 * Framework-agnostic DTOs (no zod here, see schemas.ts for validation).
 */

export type Role = "admin" | "operator" | "viewer";

export type AgentStatus =
  | "idle"
  | "running"
  | "waiting"
  | "payment_processing"
  | "completed"
  | "failed";

export type MCPServerStatus = "healthy" | "degraded" | "offline" | "disabled";

export type Network = "localnet" | "testnet" | "mainnet";

/** The three primary outcomes of the economic policy engine. */
export type PolicyDecision = "AUTO_APPROVED" | "ESCALATED" | "BLOCKED";

export type UnknownRecipientAction = "block" | "escalate" | "allow";

export type PaymentStatus =
  | "requested"
  | "evaluated"
  | "authorized"
  | "escalated"
  | "blocked"
  | "insufficient_balance"
  | "signing"
  | "submitted"
  | "confirmed"
  | "reconciling"
  | "timeout"
  | "failed";

/** Steps of the economic timeline shown in the Live Console. */
export const TIMELINE_STEPS = [
  "REQUEST",
  "402_DETECTED",
  "PRICE_DISCOVERED",
  "POLICY_EVALUATED",
  "AUTHORIZED",
  "ESCALATED",
  "ESCALATION_APPROVED",
  "BLOCKED",
  "SIGNED",
  "SUBMITTED",
  "CONFIRMED",
  "PROOF_VERIFIED",
  "RESOURCE_DELIVERED",
  "AGENT_CONTINUES",
  "RECONCILING",
  "FAILED",
] as const;

export type TimelineStep = (typeof TIMELINE_STEPS)[number];

export type TimelineEventStatus = "pending" | "confirmed" | "failed" | "blocked";

/** ------------------------------------------------------------------ */
/** Policy                                                            */
/** ------------------------------------------------------------------ */

export interface PolicyConfig {
  id: string;
  /** Monotonic version. Each saved change creates a new version. */
  version: number;
  name: string;
  /** Max ALGO per single autonomous payment. */
  perCallLimitAlgo: number;
  /** Above this ALGO amount a payment is always blocked (hard reject). */
  hardCeilingAlgo: number;
  /** Max ALGO spend for a single session/task. */
  sessionBudgetAlgo: number;
  /** Max ALGO spend per rolling day. */
  dailyBudgetAlgo: number;
  /** Max number of autonomous payments per rolling day. */
  maxDailyPayments: number;
  unknownRecipient: UnknownRecipientAction;
  firstTimeService: UnknownRecipientAction;
  recipientAllowlist: string[];
  recipientBlocklist: string[];
  serviceAllowlist: string[];
  serviceBlocklist: string[];
  /** Emergency stop: when true no autonomous payments are allowed. */
  emergencyStop: boolean;
  /** Velocity guard: max payments in rolling window (default 5/60s). */
  velocityLimitCount?: number | null;
  velocityWindowSeconds?: number | null;
  velocityAction?: "block" | "escalate" | null;
  active: boolean;
  createdAt: string;
}

export interface PolicyUpdateInput {
  name?: string;
  perCallLimitAlgo?: number;
  hardCeilingAlgo?: number;
  sessionBudgetAlgo?: number;
  dailyBudgetAlgo?: number;
  maxDailyPayments?: number;
  unknownRecipient?: UnknownRecipientAction;
  firstTimeService?: UnknownRecipientAction;
  recipientAllowlist?: string[];
  recipientBlocklist?: string[];
  serviceAllowlist?: string[];
  serviceBlocklist?: string[];
  emergencyStop?: boolean;
  velocityLimitCount?: number | null;
  velocityWindowSeconds?: number | null;
  velocityAction?: "block" | "escalate" | null;
}

export interface PolicySnapshot {
  policyVersion: number;
  active: boolean;
}

/** ------------------------------------------------------------------ */
/** Decision engine                                                    */
/** ------------------------------------------------------------------ */

export interface RuleHit {
  rule: string;
  description: string;
  severity: "info" | "warn" | "block";
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reasons: string[];
  rulesTriggered: RuleHit[];
  policyVersion: number;
  requestedAlgo: number;
  remainingSessionAlgo: number | null;
  remainingDailyAlgo: number | null;
  dailySpendAlgo: number | null;
}

/** ------------------------------------------------------------------ */
/** Payments                                                           */
/** ------------------------------------------------------------------ */

export interface PaymentRequestInput {
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
  network: Network;
  /** Deterministic idempotency key: hash(agent+session+toolcall+resource+amount). */
  clientRequestId: string;
  instructionUrl?: string;
  /** Optional note embedded in the on-chain payment. */
  note?: string;
}

export interface SettlementResult {
  txId: string;
  round: number;
  sender: string;
  recipient: string;
  amountAlgo: number;
  network: Network;
  confirmedAt: string;
  /** Algorand application ID of the KRON policy-anchor contract. */
  appId: number | null;
  /** SHA-256 hash of the policy decision anchored on-chain via app call. */
  policyHash: string | null;
  /** Transaction ID of the app call in the atomic group (separate from the payment txId). */
  appCallTxId: string | null;
}

export type PaymentDTO = {
  id: string;
  clientRequestId: string;
  agentId: string;
  sessionId: string;
  toolCallId: string;
  resourceId: string;
  resourceName: string;
  service: string;
  recipient: string;
  amountAlgo: number;
  network: Network;
  status: PaymentStatus;
  policyVersion: number | null;
  decision: PolicyDecision | null;
  decisionReasons: string[];
  txId: string | null;
  /** KRON smart contract app ID (atomic group policy anchor). */
  appId: number | null;
  /** SHA-256 policy decision hash anchored on-chain. */
  policyHash: string | null;
  /** Tx ID of the app call in the atomic group. */
  appCallTxId: string | null;
  /** Block explorer URL for the payment transaction (testnet/mainnet). */
  explorerUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

/** ------------------------------------------------------------------ */
/** MCP / tools                                                        */
/** ------------------------------------------------------------------ */

export interface MCPServerDTO {
  id: string;
  name: string;
  url: string;
  transport: "streamable-http" | "sse" | "stdio";
  authType: "none" | "header";
  status: MCPServerStatus;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  error: string | null;
  tools: MCPToolDTO[];
  createdAt: string;
}

export interface MCPToolDTO {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallDTO {
  id: string;
  sessionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  isPaid: boolean;
  paymentId: string | null;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

/** ------------------------------------------------------------------ */
/** Agents & sessions                                                  */
/** ------------------------------------------------------------------ */

export interface AgentDTO {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  walletId: string | null;
  walletAddress: string | null;
  activePolicyId: string | null;
  activePolicyVersion: number | null;
  createdAt: string;
}

export interface AgentSessionDTO {
  id: string;
  agentId: string;
  task: string | null;
  status: AgentStatus;
  totalSpendAlgo: number;
  startedAt: string;
  endedAt: string | null;
}

export interface WalletDTO {
  id: string;
  agentId: string;
  address: string;
  network: Network;
  balanceAlgo: number;
  createdAt: string;
}

/** ------------------------------------------------------------------ */
/** Analytics                                                          */
/** ------------------------------------------------------------------ */

export interface OverviewStats {
  activeAgents: number;
  healthyMcpServers: number;
  walletBalanceAlgo: number;
  todaySpendAlgo: number;
  totalSpendAlgo: number;
  totalPayments: number;
  autoApproved: number;
  escalated: number;
  blocked: number;
  approvalRatePct: number;
  paymentSuccessRatePct: number;
  avgPaymentLatencyMs: number;
  burnRateAlgoPerDay: number;
  estimatedWalletDays: number | null;
}

export interface SpendPoint {
  ts: string;
  algo: number;
}

export interface DecisionSlice {
  decision: PolicyDecision;
  count: number;
}

export interface AgentSpendRow {
  agentId: string;
  agentName: string;
  spendAlgo: number;
  payments: number;
}

export interface BurnRate {
  walletBalanceAlgo: number;
  burnRateAlgoPerDay: number;
  estimatedDays: number | null;
}

/** ------------------------------------------------------------------ */
/** Simulation                                                         */
/** ------------------------------------------------------------------ */

export interface SimulationRequest {
  /** Draft policy to simulate (must include an id-less config or full draft). */
  draft: PolicyConfig;
  /** Number of recent transactions to analyze. */
  lookbackTransactions?: number;
}

export interface SimulationResult {
  transactionsAnalyzed: number;
  current: SimulationTally;
  simulated: SimulationTally;
  reductionPct: number;
  blockedDetails: { requestId: string; amountAlgo: number; reason: string }[];
}

export interface SimulationTally {
  autoApproved: number;
  escalated: number;
  blocked: number;
  spendAlgo: number;
}

/** ------------------------------------------------------------------ */
/** Audit                                                              */
/** ------------------------------------------------------------------ */

export type AuditAction =
  | "policy.created"
  | "policy.updated"
  | "policy.version_activated"
  | "policy.emergency_stop"
  | "payment.decision"
  | "payment.settled"
  | "payment.blocked"
  | "wallet.created"
  | "wallet.funded"
  | "agent.created"
  | "session.started"
  | "mcp.server.created"
  | "mcp.server.health"
  | "auth.login"
  | "auth.demo_login"
  | "auth.logout"
  | "auth.api_key_created"
  | "api.key.created"
  | "api.key.revoked"
  | "a2a.delegated"
  | "security.event";



export interface AuditEntryDTO {
  id: string;
  ts: string;
  actorId: string | null;
  actorType: "user" | "system" | "agent";
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  policyVersion: number | null;
}
