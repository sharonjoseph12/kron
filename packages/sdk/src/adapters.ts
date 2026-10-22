/**
 * KRON SDK — Framework Adapters
 *
 * Lightweight adapters that wrap KRON's policy-controlled paid tool calling
 * into popular AI agent frameworks. Zero extra dependencies — each adapter
 * returns the framework's native tool shape so it plugs in with one line.
 *
 * Supported frameworks:
 *  - LangChain / LangGraph  →  `asLangChainTools()`
 *  - LlamaIndex             →  `asLlamaIndexTools()`
 *  - Vercel AI SDK          →  `asVercelAITools()`
 *  - Raw function calling   →  `asOpenAIFunctions()`
 *
 * @example
 * ```typescript
 * import { KronClient } from "@kron/sdk";
 * import { asLangChainTools } from "@kron/sdk/adapters";
 *
 * const kron = new KronClient({ apiUrl: "http://localhost:8787" });
 * await kron.login("operator@kron.local", process.env.KRON_ADMIN_PASSWORD!);
 *
 * const tools = asLangChainTools(kron, {
 *   agentId: "researcher-01",
 *   sessionId: session.id,
 * });
 * // → pass `tools` directly to ChatOpenAI.bindTools() or AgentExecutor
 * ```
 */

import type { KronClient } from "./client.js";
import type { CallToolInput, CallToolResult, EvaluationInput, EvaluationResult } from "./types.js";

/* ------------------------------------------------------------------ */
/* Shared options                                                      */
/* ------------------------------------------------------------------ */

export interface AdapterOptions {
  /** The agent making tool calls. */
  agentId: string;
  /** Active session ID. */
  sessionId: string;
  /** MCP server ID (optional — KRON resolves automatically). */
  serverId?: string;
}

/* ------------------------------------------------------------------ */
/* LangChain / LangGraph Adapter                                       */
/* ------------------------------------------------------------------ */

/**
 * LangChain DynamicStructuredTool-compatible shape.
 * Matches `@langchain/core/tools` without importing it.
 */
export interface LangChainTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  func: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * Convert KRON's paid tool calling into LangChain-compatible tools.
 *
 * Returns an array that can be passed directly to:
 * - `ChatOpenAI.bindTools(tools)`
 * - `AgentExecutor.fromAgentAndTools({ tools })`
 * - `createReactAgent({ tools })`
 *
 * @example
 * ```typescript
 * const tools = asLangChainTools(kron, { agentId: "researcher-01", sessionId });
 * const agent = createReactAgent({ llm, tools });
 * ```
 */
export function asLangChainTools(client: KronClient, opts: AdapterOptions): LangChainTool[] {
  return [
    {
      name: "kron_call_paid_tool",
      description:
        "Call a paid MCP tool through KRON. KRON evaluates the agent's spending policy and settles any required x402 payment on Algorand automatically. Returns the tool result and payment proof.",
      schema: {
        type: "object" as const,
        properties: {
          tool: { type: "string", description: 'Tool name (e.g., "market/report")' },
          arguments: {
            type: "object",
            description: "Tool arguments (passed to the MCP tool)",
            additionalProperties: true,
          },
        },
        required: ["tool"],
      },
      func: async (input: Record<string, unknown>): Promise<string> => {
        const result = await client.callPaidTool({
          agentId: opts.agentId,
          sessionId: opts.sessionId,
          tool: input.tool as string,
          serverId: opts.serverId,
          arguments: (input.arguments as Record<string, unknown>) ?? {},
        });
        return formatResult(result);
      },
    },
    {
      name: "kron_evaluate_payment",
      description:
        "Dry-run a payment against the agent's policy WITHOUT moving funds. Returns the decision (AUTO_APPROVED, BLOCKED, ESCALATED) and reasons.",
      schema: {
        type: "object" as const,
        properties: {
          recipient: { type: "string", description: "Algorand address of the recipient" },
          amountAlgo: { type: "number", description: "Amount in ALGO" },
          service: { type: "string", description: 'Service category (e.g., "research")' },
        },
        required: ["recipient", "amountAlgo"],
      },
      func: async (input: Record<string, unknown>): Promise<string> => {
        const result = await client.evaluatePayment(opts.agentId, {
          recipient: input.recipient as string,
          amountAlgo: input.amountAlgo as number,
          service: input.service as string | undefined,
          sessionId: opts.sessionId,
        });
        return JSON.stringify(result.evaluation, null, 2);
      },
    },
    {
      name: "kron_get_wallet",
      description:
        "Check the agent's Algorand wallet balance. Returns the address, network, and current ALGO balance.",
      schema: {
        type: "object" as const,
        properties: {},
      },
      func: async (): Promise<string> => {
        const agent = await client.getAgent(opts.agentId);
        return JSON.stringify({
          address: agent.walletAddress,
          agentName: agent.name,
          status: agent.status,
        });
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* OpenAI Function Calling Adapter                                     */
/* ------------------------------------------------------------------ */

/**
 * OpenAI function calling shape (works with raw OpenAI SDK, Vercel AI, etc.).
 */
export interface OpenAIFunction {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert KRON tools into OpenAI function calling format.
 *
 * @example
 * ```typescript
 * const tools = asOpenAIFunctions(kron, { agentId, sessionId });
 * const response = await openai.chat.completions.create({
 *   model: "gpt-4o",
 *   tools,
 *   messages,
 * });
 * ```
 */
export function asOpenAIFunctions(client: KronClient, opts: AdapterOptions): OpenAIFunction[] {
  const lc = asLangChainTools(client, opts);
  return lc.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));
}

/**
 * Execute an OpenAI function call result through KRON.
 * Use this to handle tool_calls from the OpenAI API response.
 */
export async function executeOpenAIFunction(
  client: KronClient,
  opts: AdapterOptions,
  functionName: string,
  argumentsJson: string,
): Promise<string> {
  const tools = asLangChainTools(client, opts);
  const tool = tools.find((t) => t.name === functionName);
  if (!tool) throw new Error(`Unknown KRON function: ${functionName}`);
  const args = JSON.parse(argumentsJson) as Record<string, unknown>;
  return tool.func(args);
}

/* ------------------------------------------------------------------ */
/* Vercel AI SDK Adapter                                               */
/* ------------------------------------------------------------------ */

/**
 * Vercel AI SDK tool shape.
 * Matches `ai` package's `tool()` return type without importing it.
 */
export interface VercelAITool {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Convert KRON tools into Vercel AI SDK format.
 *
 * @example
 * ```typescript
 * const kronTools = asVercelAITools(kron, { agentId, sessionId });
 * const result = await generateText({
 *   model: openai("gpt-4o"),
 *   tools: kronTools,
 *   prompt: "Buy the market report",
 * });
 * ```
 */
export function asVercelAITools(
  client: KronClient,
  opts: AdapterOptions,
): Record<string, VercelAITool> {
  const lc = asLangChainTools(client, opts);
  const result: Record<string, VercelAITool> = {};
  for (const t of lc) {
    result[t.name] = {
      description: t.description,
      parameters: t.schema,
      execute: async (args: Record<string, unknown>) => {
        const text = await t.func(args);
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      },
    };
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatResult(result: CallToolResult): string {
  const parts: string[] = [];

  if (result.payment) {
    parts.push(`Payment: ${result.payment.status ?? "settled"}`);
    parts.push(`Amount: ${result.payment.amountAlgo} ALGO`);
    if (result.payment.txId) parts.push(`Algorand Tx: ${result.payment.txId}`);
    if (result.payment.reasons.length > 0) {
      parts.push(`Reasons: ${result.payment.reasons.join("; ")}`);
    }
  }

  const textContent = result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!)
    .join("\n");

  if (textContent) parts.push(textContent);
  if (result.error) parts.push(`Error: ${result.error}`);

  return parts.join("\n");
}
