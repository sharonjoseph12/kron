import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  extractPaymentRequired,
  KRON_TOOLS,
  microToAlgo,
  type X402Instruction,
} from "@kron/shared";
import type { ToolDefinition } from "./types.js";

export interface KronToolsOptions {
  /** Agent whose wallet/policy KRON applies. Injected into every tool call. */
  agentId: string;
  /** Active agent session. Injected into tool calls that need it. */
  sessionId: string;
  /** KRON API base URL, e.g. "http://localhost:8787". */
  kronUrl: string;
}

export interface KronToolsHandle {
  tools: ToolDefinition[];
  close(): Promise<void>;
}

/**
 * Connect to KRON's MCP server and build the `kron.*` tool set for the agent.
 * `agentId` / `sessionId` are injected server-side and stripped from the
 * schemas shown to the model, so the model only thinks about intent.
 */
export async function connectKronTools(opts: KronToolsOptions): Promise<KronToolsHandle> {
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", opts.kronUrl));
  const client = new Client({ name: "kron-llm-agent", version: "1.0.0" });
  await client.connect(transport);
  return {
    tools: buildKronTools(client, opts),
    close: async () => {
      await transport.terminateSession().catch(() => {});
      await client.close().catch(() => {});
    },
  };
}

function buildKronTools(client: Client, opts: KronToolsOptions): ToolDefinition[] {
  const [listTools, callTool, getWallet, evaluatePayment] = KRON_TOOLS;

  return [
    {
      name: listTools.name,
      description: listTools.description,
      inputSchema: schemaWithout(listTools.inputSchema, []),
      execute: (args) => callKron(client, "kron.list_available_tools", args),
    },
    {
      name: callTool.name,
      description:
        "Invoke a tool from a registered MCP resource server. KRON evaluates the agent policy and settles any required x402 payment on Algorand automatically — the caller just describes intent.",
      inputSchema: schemaWithout(callTool.inputSchema, ["agentId", "sessionId"]),
      execute: (args) =>
        callKron(client, "kron.call_tool", {
          ...args,
          agentId: opts.agentId,
          sessionId: opts.sessionId,
        }),
    },
    {
      name: getWallet.name,
      description: getWallet.description,
      inputSchema: schemaWithout(getWallet.inputSchema, ["agentId"]),
      execute: (args) => callKron(client, "kron.get_wallet", { ...args, agentId: opts.agentId }),
    },
    {
      name: evaluatePayment.name,
      description: evaluatePayment.description,
      inputSchema: schemaWithout(evaluatePayment.inputSchema, ["agentId"]),
      execute: (args) =>
        callKron(client, "kron.evaluate_payment", { ...args, agentId: opts.agentId }),
    },
  ];
}

function schemaWithout(
  schema: Record<string, unknown>,
  injected: string[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = { ...(schema.properties as Record<string, unknown>) };
  for (const key of injected) delete properties[key];
  const required = ((schema.required as string[] | undefined) ?? []).filter((k) => !injected.includes(k));
  const out: Record<string, unknown> = { ...schema, properties };
  if (required.length > 0) out.required = required;
  else delete out.required;
  return out;
}

interface CallToolLike {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

/**
 * Invoke a `kron.*` tool and render the result as plain text for the model.
 * x402 payment-required markers are converted into a readable explanation so
 * the model can decide to route the call through `kron.call_tool`.
 */
async function callKron(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const raw = (await client.callTool({ name, arguments: args })) as CallToolLike & {
    structuredContent?: unknown;
  };

  const marker = extractPaymentRequired(raw);
  if (marker) return formatPaymentRequired(marker.instruction);

  const text = flattenContent(raw);
  if (raw.isError === true || text.startsWith("ERROR:")) {
    return `ERROR: ${text.replace(/^ERROR:\s*/, "")}`;
  }
  return text;
}

function flattenContent(raw: CallToolLike): string {
  const parts = (raw.content ?? [])
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : JSON.stringify(item)))
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : JSON.stringify(raw);
}

export function formatPaymentRequired(instr: X402Instruction): string {
  return [
    `PAYMENT REQUIRED (x402) to access "${instr.resource.name}".`,
    `Price: ${microToAlgo(instr.amount).toFixed(6)} ALGO on ${instr.network}.`,
    `Recipient: ${instr.recipient}.`,
    'To purchase, call kron.call_tool with tool = "' + instr.resource.id + '" and KRON will settle the payment automatically against your policy.',
  ].join("\n");
}