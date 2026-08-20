import type {
  PolicyDecision,
  PaymentDTO,
  PolicyEvaluation,
  OverviewStats as SharedOverviewStats,
  StreamEvent,
} from "@kron/shared";

/* ------------------------------------------------------------------ */
/* Agent                                                               */
/* ------------------------------------------------------------------ */

/** An AI agent registered with KRON. */
export interface Agent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  walletAddress: string | null;
  activePolicyVersion: number | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Wallet                                                              */
/* ------------------------------------------------------------------ */

/** Agent wallet information. */
export interface WalletInfo {
  agentId: string;
  address: string;
  network: string;
  balanceAlgo: number;
}

/** Result of funding an agent's wallet. */
export interface FundResult {
  address: string;
  balanceAlgo: number;
}

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

/** Input for creating/updating an agent's spending policy. */
export interface PolicyInput {
  /** Maximum ALGO per single payment (default: 0.05). */
  perCallLimitAlgo?: number;
  /** Maximum total ALGO an agent may ever spend (default: 10). */
  hardCeilingAlgo?: number;
  /** Maximum ALGO per session (default: 5). */
  sessionBudgetAlgo?: number;
  /** Maximum ALGO per calendar day (default: 5). */
  dailyBudgetAlgo?: number;
  /** Maximum number of payments per day (default: 100). */
  maxDailyPayments?: number;
  /** What to do with unknown recipients: "allow" | "escalate" | "block". */
  unknownRecipient?: "allow" | "escalate" | "block";
  /** What to do with first-time services: "allow" | "escalate" | "block". */
  firstTimeService?: "allow" | "escalate" | "block";
  /** Algorand addresses to always allow. */
  recipientAllowlist?: string[];
  /** Algorand addresses to always block. */
  recipientBlocklist?: string[];
  /** Service names to always allow. */
  serviceAllowlist?: string[];
  /** Service names to always block. */
  serviceBlocklist?: string[];
  /** Kill switch — immediately blocks all payments. */
  emergencyStop?: boolean;
}

/** Result of a policy update. */
export interface PolicyResult {
  name: string;
  version: number;
  active: boolean;
  perCallLimitAlgo: number;
  hardCeilingAlgo: number;
  sessionBudgetAlgo: number;
  dailyBudgetAlgo: number;
  maxDailyPayments: number;
  unknownRecipient: string;
  firstTimeService: string;
  recipientAllowlist: string[];
  recipientBlocklist: string[];
  serviceAllowlist: string[];
  serviceBlocklist: string[];
  emergencyStop: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

/** Input for dry-running a payment against an agent's policy. */
export interface EvaluationInput {
  /** Algorand address of the payment recipient. */
  recipient: string;
  /** Amount in ALGO. */
  amountAlgo: number;
  /** Service category (e.g., "research", "compute"). */
  service?: string;
  /** Session ID (optional, for session-budget tracking). */
  sessionId?: string;
}

/** Result of a dry-run policy evaluation. */
export interface EvaluationResult {
  evaluation: PolicyEvaluation;
}

/* ------------------------------------------------------------------ */
/* Tool calling                                                        */
/* ------------------------------------------------------------------ */

/** Input for calling a paid MCP tool through KRON. */
export interface CallToolInput {
  /** The agent making the call. */
  agentId: string;
  /** Active session ID (create one with startSession). */
  sessionId: string;
  /** Tool name (e.g., "market/report"). */
  tool: string;
  /** MCP server ID (optional — KRON resolves it if omitted). */
  serverId?: string;
  /** Tool arguments (passed to the MCP tool). */
  arguments?: Record<string, unknown>;
}

/** Result of a paid tool call. */
export interface CallToolResult {
  ok: boolean;
  isPaid: boolean;
  content: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  error?: string;
  payment?: {
    status: string | null;
    amountAlgo: number;
    resourceName: string;
    txId: string | null;
    reasons: string[];
    explorerUrl: string | null;
  };
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/** An agent session. */
export interface SessionInfo {
  id: string;
  agentId: string;
  task: string | null;
  status: string;
  startedAt: string;
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export type { SharedOverviewStats as OverviewStats };

/* ------------------------------------------------------------------ */
/* Agent-to-Agent (A2A) Hiring                                         */
/* ------------------------------------------------------------------ */

/** Input for an agent hiring another agent. */
export interface HireAgentInput {
  /** Hiring agent ID. */
  agentId: string;
  /** Target agent ID to hire. */
  targetAgentId: string;
  /** Subtask description. */
  task: string;
  /** Payment compensation in ALGO. */
  amountAlgo: number;
  /** Optional active session ID. */
  sessionId?: string;
}

/** Result of an agent-to-agent hire execution. */
export interface HireAgentResult {
  ok: boolean;
  status: string;
  hiredAgent?: { id: string; name: string };
  taskResult?: string;
  reasons?: string[];
  flow?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** Handler for SSE stream events. */
export type StreamEventHandler = (event: StreamEvent) => void;

