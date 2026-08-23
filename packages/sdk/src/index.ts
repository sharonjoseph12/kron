/**
 * KRON SDK — Policy-Controlled Economic Runtime for AI Agents
 *
 * Give AI agents economic autonomy with policy-controlled payments on Algorand.
 *
 * @example
 * ```typescript
 * import { KronClient } from "@kron/sdk";
 *
 * const kron = new KronClient({ apiUrl: "http://localhost:8787" });
 * await kron.login("admin@kron.dev", "admin1234");
 *
 * // Create an agent with a wallet and policy
 * const agent = await kron.createAgent("researcher", "Market research agent");
 * await kron.fundWallet(agent.id);
 *
 * // Set spending policy
 * await kron.setPolicy(agent.id, {
 *   perCallLimitAlgo: 0.05,
 *   dailyBudgetAlgo: 5,
 *   unknownRecipient: "block",
 * });
 *
 * // Call a paid tool — KRON handles x402 payment automatically
 * const session = await kron.startSession(agent.id, "Analyze semiconductor market");
 * const result = await kron.callPaidTool({
 *   agentId: agent.id,
 *   sessionId: session.id,
 *   tool: "market/report",
 * });
 * // result.payment.txId → real Algorand transaction ID
 * ```
 *
 * @packageDocumentation
 */

export { KronClient, type KronClientConfig } from "./client.js";
export type {
  Agent,
  WalletInfo,
  FundResult,
  PolicyInput,
  PolicyResult,
  EvaluationInput,
  EvaluationResult,
  CallToolInput,
  CallToolResult,
  SessionInfo,
  OverviewStats,
  StreamEventHandler,
} from "./types.js";

// Framework adapters — LangChain, OpenAI, Vercel AI SDK
export {
  asLangChainTools,
  asOpenAIFunctions,
  executeOpenAIFunction,
  asVercelAITools,
  type AdapterOptions,
  type LangChainTool,
  type OpenAIFunction,
  type VercelAITool,
} from "./adapters.js";

// Re-export shared types that SDK consumers need
export type {
  PolicyDecision,
  PaymentDTO,
  PolicyEvaluation,
  TimelineEvent,
  StreamEvent,
  Network,
} from "@kron/shared";
