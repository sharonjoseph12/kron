/**
 * Contract between KRON's MCP gateway (MCP *client* to external resource
 * servers) and external MCP servers exposing paid tools.
 *
 * A paid MCP tool returns a tool result whose first content item carries a
 * structured `data` marker signalling "this resource requires payment". KRON
 * then fetches the x402 instruction, evaluates policy, pays, and retries the
 * tool call with a `paymentToken` argument injected.
 */
import type { X402Challenge, X402Instruction } from "./protocol.js";

/** Reserved argument name injected by the gateway when retrying a paid tool. */
export const MCP_PAYMENT_TOKEN_ARG = "paymentToken";

/** Marker type on tool result content items. */
export const X402_PAYMENT_REQUIRED = "x402-payment-required";

export interface PaymentRequiredData {
  type: typeof X402_PAYMENT_REQUIRED;
  challenge: X402Challenge;
  instruction: X402Instruction;
}

/**
 * Detects a payment-required marker inside an MCP tool result.
 *
 * Preferred carrier is `structuredContent` (a CallToolResult field reserved
 * for structured output that survives the SDK's zod validation). Legacy
 * support: a content item carrying a `data` key.
 */
export function extractPaymentRequired(
  result: unknown,
): PaymentRequiredData | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  const structured = r.structuredContent as Partial<PaymentRequiredData> | undefined;
  if (structured && typeof structured === "object" && structured.type === X402_PAYMENT_REQUIRED) {
    if (structured.challenge && structured.instruction) {
      return {
        type: X402_PAYMENT_REQUIRED,
        challenge: structured.challenge as X402Challenge,
        instruction: structured.instruction as X402Instruction,
      };
    }
  }

  const content = Array.isArray(r.content) ? r.content : [];
  for (const item of content) {
    if (item && typeof item === "object") {
      const it = item as Record<string, unknown>;
      const data = it.data as Partial<PaymentRequiredData> | undefined;
      if (data && data.type === X402_PAYMENT_REQUIRED) {
        if (data.challenge && data.instruction) {
          return {
            type: X402_PAYMENT_REQUIRED,
            challenge: data.challenge as X402Challenge,
            instruction: data.instruction as X402Instruction,
          };
        }
      }
    }
  }
  return null;
}

/** Tools exposed by KRON's own MCP server to agents. */
export const KRON_TOOLS = [
  {
    name: "kron.list_available_tools",
    description:
      "List every tool currently exposed by registered MCP resource servers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kron.call_tool",
    description:
      "Invoke a tool from a registered MCP resource server. KRON handles any x402 payment automatically against the agent's policy.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string" },
        serverId: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["tool"],
    },
  },
  {
    name: "kron.get_wallet",
    description:
      "Return the agent's dedicated wallet address and ALGO balance.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "kron.evaluate_payment",
    description:
      "Dry-run a payment request against the agent's active policy. No money moves.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        recipient: { type: "string" },
        amountAlgo: { type: "number" },
        service: { type: "string" },
        resourceName: { type: "string" },
      },
      required: ["agentId", "recipient", "amountAlgo"],
    },
  },
] as const;
