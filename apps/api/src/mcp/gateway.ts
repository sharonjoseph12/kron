/**
 * MCP Gateway — KRON as an MCP *client* to registered resource servers
 * (FR-MCP-001..004). Handles:
 *   - connection testing + tool discovery
 *   - health checks (healthy / degraded / offline / disabled)
 *   - tool invocation with transparent x402 payment handling:
 *         call -> 402 (payment_required) -> policy -> pay -> retry with token
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { extractPaymentRequired, X402_PAYMENT_REQUIRED, MCP_PAYMENT_TOKEN_ARG } from "@kron/shared";
import type { MCPServerDTO, MCPToolDTO } from "@kron/shared";
import type { McpServer, McpTool } from "@prisma/client";
import { prisma } from "../db.js";
import { executePaymentFlow, type ExecutePaymentResult } from "../services/payment-flow.js";
import { recordAudit } from "../services/audit.js";
import { hub } from "../events/hub.js";
import { isSafeUrl } from "../lib/ssrf.js";
import { decryptMnemonic } from "../algorand/vault.js";

interface ServerRecord {
  id: string;
  url: string;
  transport: string;
  authTokenEnc?: string | null;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  tools: { name: string; description?: string; inputSchema?: unknown }[];
}

export interface ToolOutcome {
  ok: boolean;
  content: unknown[];
  isPaid: boolean;
  payment: {
    status: ExecutePaymentResult["status"] | null;
    amountAlgo?: number;
    resourceName?: string;
    txId?: string | null;
    reasons?: string[];
  };
  error?: string;
}

function transportFor(
  server: ServerRecord,
  headers: Record<string, string>,
): StreamableHTTPClientTransport | SSEClientTransport {
  let url = new URL(server.url);
  if (server.transport === "streamable-http" && (url.pathname === "/" || url.pathname === "")) {
    url.pathname = "/mcp";
  }
  if (server.transport === "sse") {
    return new SSEClientTransport(url, { requestInit: { headers } });
  }
  return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
}

function headersFor(server: ServerRecord): Record<string, string> {
  if (!server.authTokenEnc) return {};
  try {
    // authTokenEnc is AES-256-GCM ciphertext from the vault — decrypt before
    // sending. Never transmit the stored ciphertext.
    return { Authorization: `Bearer ${decryptMnemonic(server.authTokenEnc)}` };
  } catch (err) {
    console.warn(`[mcp-gateway] failed to decrypt auth token for server ${server.id}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

async function withClient<T>(server: ServerRecord, fn: (client: Client) => Promise<T>): Promise<T> {
  const safe = isSafeUrl(server.url);
  if (!safe.ok) throw new Error(`SSRF blocked: ${safe.reason} (${server.url})`);
  const transport = transportFor(server, headersFor(server));
  const client = new Client({ name: "kron-gateway", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Connect, list tools, measure latency. */
export async function testServer(server: ServerRecord): Promise<TestResult> {
  const started = Date.now();
  try {
    const tools = await withClient(server, (c) => c.listTools());
    return {
      ok: true,
      latencyMs: Date.now() - started,
      error: null,
      tools: (tools.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : "MCP connection failed",
      tools: [],
    };
  }
}

export type ServerStatus = "healthy" | "degraded" | "offline" | "disabled";

function toMCPToolDTO(t: McpTool): MCPToolDTO {
  return {
    id: t.id,
    serverId: t.serverId,
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
  };
}

export function toMCPServerDTO(s: McpServer): MCPServerDTO {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    transport: (s.transport as MCPServerDTO["transport"]) ?? "streamable-http",
    authType: s.authTokenEnc ? "header" : "none",
    status: (s.status as MCPServerDTO["status"]) ?? "offline",
    lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
    latencyMs: s.latencyMs,
    error: s.error,
    tools: ((s as McpServer & { tools?: McpTool[] }).tools ?? []).map(toMCPToolDTO),
    createdAt: s.createdAt.toISOString(),
  };
}

/** Refresh stored tool list for a server + update health status. */
export async function refreshMCPTools(McpServer: McpServer): Promise<TestResult> {
  const result = await testServer(McpServer);
  const status: ServerStatus = McpServer.enabled
    ? result.ok
      ? result.latencyMs! > 1500
        ? "degraded"
        : "healthy"
      : "offline"
    : "disabled";

  await prisma.mcpServer.update({
    where: { id: McpServer.id },
    data: {
      status,
      latencyMs: result.latencyMs,
      error: result.error,
      lastCheckedAt: new Date(),
    },
  });

  if (result.ok) {
    for (const t of result.tools) {
      await prisma.mcpTool.upsert({
        where: { serverId_name: { serverId: McpServer.id, name: t.name } },
        create: {
          serverId: McpServer.id,
          name: t.name,
          description: t.description ?? null,
          inputSchema: t.inputSchema as object,
        },
        update: { description: t.description ?? null, inputSchema: t.inputSchema as object },
      });
    }
  }

  const updated = await prisma.mcpServer.findUnique({
    where: { id: McpServer.id },
    include: { tools: true },
  });
  if (updated) {
    hub.publish({ type: "mcp.health", server: toMCPServerDTO(updated) });
  }
  return result;
}

export interface CallToolArgs {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** KRON-side trace context used to bill the right agent/session. */
  trace: {
    agentId: string;
    sessionId: string;
    toolCallId: string;
  };
}

/**
 * Invoke an external MCP tool. If the tool responds with a payment-required
 * marker, KRON runs the economic flow and, when AUTO_APPROVED, retries the
 * tool call with the payment token injected.
 */
export async function callExternalTool(call: CallToolArgs): Promise<ToolOutcome> {
  const server = await prisma.mcpServer.findUnique({ where: { id: call.serverId } });
  if (!server) throw new Error("MCP server not found");
  if (!server.enabled) {
    return { ok: false, content: [], isPaid: false, payment: { status: null }, error: "MCP server disabled" };
  }

  let first = true;
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;
    let output: unknown;
    try {
      output = await withClient(server, (c) => c.callTool({ name: call.toolName, arguments: call.args }));
    } catch (err) {
      return {
        ok: false,
        content: [],
        isPaid: false,
        payment: { status: null },
        error: err instanceof Error ? err.message : "MCP tool call failed",
      };
    }

    const result = output as { content?: unknown[] };
    const paymentReq = extractPaymentRequired(output);
    if (!paymentReq) {
      // Normal (or already-paid) result.
      return {
        ok: true,
        content: Array.isArray(result?.content) ? result.content : [result],
        isPaid: !first,
        payment: { status: null },
      };
    }

    first = false; // we detected a payment requirement
    const instr = paymentReq.instruction;
    const flow = await executePaymentFlow({
      agentId: call.trace.agentId,
      sessionId: call.trace.sessionId,
      toolCallId: call.trace.toolCallId,
      mcpServerId: call.serverId,
      toolName: call.toolName,
      service: server.name,
      resourceId: instr.resource.id,
      resourceName: instr.resource.name,
      recipient: instr.recipient,
      amountAlgo: Number(instr.amount) / 1_000_000,
      network: instr.network,
      instructionUrl: paymentReq.challenge.paymentUrl,
      note: instr.note,
      amountMicro: instr.amount,
      asset: instr.asset.type === "asa" ? { type: "asa" as const, assetId: instr.asset.assetId!, decimals: instr.asset.decimals } : undefined,
    });

    if (flow.status !== "AUTO_APPROVED") {
      return {
        ok: false,
        content: [
          {
            type: "text",
            text:
              flow.status === "BLOCKED"
                ? `PAYMENT DENIED — POLICY VIOLATION\n${flow.reasons.join("\n")}`
                : flow.status === "RECONCILING"
                  ? "PAYMENT STATUS UNKNOWN — RECONCILING ON-CHAIN"
                  : `ESCALATION REQUIRED\n${flow.reasons.join("\n")}`,
          },
        ],
        isPaid: false,
        payment: {
          status: flow.status,
          amountAlgo: flow.payment.amountAlgo,
          resourceName: instr.resource.name,
          txId: flow.txId,
          reasons: flow.reasons,
        },
      };
    }

    // Paid! Retry the tool with the payment token injected.
    return withClient(server, (c) =>
      c
        .callTool({
          name: call.toolName,
          arguments: { ...call.args, [MCP_PAYMENT_TOKEN_ARG]: flow.token },
        })
        .then(async (r) => {
          await recordAudit({
            actorType: "agent",
            actorId: call.trace.agentId,
            action: "payment.settled",
            targetType: "ToolCall",
            targetId: call.trace.toolCallId,
            summary: `Tool ${call.toolName} paid with ${flow.payment.amountAlgo.toFixed(4)} ALGO and delivered`,
          });
          return {
            ok: true,
            content: Array.isArray(r.content) ? r.content : [r.content],
            isPaid: true,
            payment: {
              status: "AUTO_APPROVED",
              amountAlgo: flow.payment.amountAlgo,
              resourceName: instr.resource.name,
              txId: flow.txId,
            },
          } satisfies ToolOutcome;
        }),
    );
  }

  return {
    ok: false,
    content: [],
    isPaid: false,
    payment: { status: null },
    error: "Too many attempts calling paid resource",
  };
}

export { X402_PAYMENT_REQUIRED };

export type { ListToolsResult };