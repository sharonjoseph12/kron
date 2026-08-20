/**
 * Real-time event contract between the KRON API (SSE) and consumers
 * (dashboard, demo tooling). Every message is a JSON object of one of
 * these discriminated types.
 */
import type {
  AuditEntryDTO,
  AgentDTO,
  AgentSessionDTO,
  MCPServerDTO,
  PaymentDTO,
  PolicyEvaluation,
  PolicyConfig,
  TimelineEventStatus,
  TimelineStep,
  WalletDTO,
} from "./types.js";

export interface TimelineEvent {
  id: string;
  sessionId: string;
  agentId: string;
  seq: number;
  step: TimelineStep;
  status: TimelineEventStatus;
  message: string;
  detail?: Record<string, unknown>;
  ts: string;
}

export interface ToolCallEvent {
  id: string;
  sessionId: string;
  toolName: string;
  phase: "started" | "completed" | "failed";
  paid: boolean;
  args?: Record<string, unknown>;
  message: string;
  ts: string;
}

export type StreamEvent =
  | { type: "hello"; ts: string }
  | { type: "session.updated"; session: AgentSessionDTO }
  | { type: "agent.updated"; agent: AgentDTO }
  | { type: "timeline"; event: TimelineEvent }
  | { type: "tool.call"; event: ToolCallEvent }
  | { type: "payment.created"; payment: PaymentDTO }
  | { type: "payment.updated"; payment: PaymentDTO }
  | { type: "decision"; decision: PolicyEvaluation; paymentId: string; request: unknown }
  | { type: "policy.updated"; policy: PolicyConfig }
  | { type: "wallet.updated"; wallet: WalletDTO }
  | { type: "mcp.health"; server: MCPServerDTO }
  | { type: "audit"; entry: AuditEntryDTO }
  | { type: "ping"; ts: string };

/** SSE comment used to keep connections alive. */
export const SSE_KEEPALIVE_MS = 15000;
