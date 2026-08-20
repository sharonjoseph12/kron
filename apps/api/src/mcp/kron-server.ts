/**
 * KRON MCP Server — the control surface agents connect to (FR-MCP-001).
 *
 * Exposes kron.* tools so that ANY MCP client (Claude, a custom agent, etc.)
 * can discover paid resources and invoke them with KRON handling the x402
 * economics automatically. Mounted at POST/GET/DELETE /mcp (Streamable HTTP).
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { KRON_TOOLS } from "@kron/shared";
import type { StreamableHTTPServerTransport as Transport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { callExternalTool } from "./gateway.js";
import { evaluateForAgent } from "../services/policies.js";
import { algoToMicro } from "../lib/money.js";
import type { ApiKeyPrincipal } from "../lib/api-keys.js";

interface McpSession {
  transport: Transport;
  principal: ApiKeyPrincipal | null;
}

const sessions = new Map<string, McpSession>();

export function createKronMcpServer(principal: ApiKeyPrincipal | null = null): Server {
  const server = new Server(
    { name: "kron", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: KRON_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      if (name === "kron.list_available_tools") {
        return text(await listAvailableTools());
      }
      if (name === "kron.call_tool") {
        return text(await callPaidTool(args, principal));
      }
      if (name === "kron.get_wallet") {
        return text(await getWallet(args, principal));
      }
      if (name === "kron.evaluate_payment") {
        return text(await dryRunPayment(args, principal));
      }
      return errorText(`Unknown tool: ${name}`);
    } catch (err) {
      return errorText(err instanceof Error ? err.message : String(err));
    }
  });

  return server;
}

/**
 * When a principal is bound to an agent, agent identity is forced to that
 * agent. Admin keys (no agent binding) may act as any agent.
 */
function resolveAgentId(requested: string | undefined, principal: ApiKeyPrincipal | null): string {
  if (principal?.agentId) {
    if (requested && requested !== principal.agentId) {
      throw new Error(
        `This API key is bound to agent ${principal.agentId} — refusing to act as ${requested}`,
      );
    }
    return principal.agentId;
  }
  if (!requested) throw new Error("This tool requires an 'agentId' argument");
  return requested;
}

function text(json: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] };
}

function errorText(message: string) {
  return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
}

async function listAvailableTools(): Promise<unknown> {
  const tools = await prisma.mcpTool.findMany({
    include: { server: { select: { id: true, name: true, status: true } } },
    orderBy: { serverId: "asc" },
  });
  return {
    count: tools.length,
    tools: tools.map((t) => ({
      serverId: t.serverId,
      serverName: t.server.name,
      serverStatus: t.server.status,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

async function callPaidTool(args: Record<string, unknown>, principal: ApiKeyPrincipal | null): Promise<unknown> {
  const tool = typeof args.tool === "string" ? args.tool : undefined;
  const serverId = typeof args.serverId === "string" ? args.serverId : undefined;
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;
  const toolArgs = (args.arguments as Record<string, unknown>) ?? {};
  if (!tool) throw new Error("kron.call_tool requires a 'tool' argument");
  const agentId = resolveAgentId(typeof args.agentId === "string" ? args.agentId : undefined, principal);

  const session = sessionId
    ? { id: sessionId }
    : await prisma.agentSession.findFirst({
        where: { agentId, status: "running" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
  if (!session) throw new Error("No active session — start one for the agent first");

  const outcome = await callExternalTool({
    serverId: serverId ?? (await resolveServerForTool(tool)),
    toolName: tool,
    args: toolArgs,
    trace: { agentId, sessionId: session.id, toolCallId: `mcp_${randomUUID().slice(0, 8)}` },
  });
  return outcome;
}

async function resolveServerForTool(toolName: string): Promise<string> {
  const tool = await prisma.mcpTool.findFirst({ where: { name: toolName } });
  if (!tool) throw new Error(`Tool "${toolName}" is not available on any registered server`);
  return tool.serverId;
}

async function getWallet(args: Record<string, unknown>, principal: ApiKeyPrincipal | null): Promise<unknown> {
  const agentId = resolveAgentId(typeof args.agentId === "string" ? args.agentId : undefined, principal);
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { wallet: true } });
  if (!agent?.wallet) throw new Error("Agent or wallet not found");
  const balance = await algorand.getBalanceAlgo(agent.wallet.address);
  return {
    agentId,
    address: agent.wallet.address,
    network: agent.wallet.network,
    balanceAlgo: balance,
  };
}

async function dryRunPayment(args: Record<string, unknown>, principal: ApiKeyPrincipal | null): Promise<unknown> {
  const agentId = resolveAgentId(typeof args.agentId === "string" ? args.agentId : undefined, principal);
  const recipient = typeof args.recipient === "string" ? args.recipient : undefined;
  const amountAlgo = typeof args.amountAlgo === "number" ? args.amountAlgo : undefined;
  const service = typeof args.service === "string" ? args.service : "unknown";
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;
  if (!recipient || !amountAlgo || amountAlgo <= 0) {
    throw new Error("kron.evaluate_payment requires recipient and positive amountAlgo");
  }
  const { evaluation } = await evaluateForAgent(agentId, sessionId, {
    amountMicro: algoToMicro(amountAlgo),
    recipient,
    service,
  });
  return evaluation;
}

/** MCP Streamable HTTP request router. Call from the Fastify routes. */
export async function handleKronMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body?: unknown,
  principal: ApiKeyPrincipal | null = null,
): Promise<void> {
  const sessionId = (req.headers["mcp-session-id"] as string) ?? undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    const server = createKronMcpServer(principal);
    await server.connect(transport);
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      void server.close();
    };
    await transport.handleRequest(req, res, body);
    if (transport.sessionId) sessions.set(transport.sessionId, { transport, principal });
    return;
  }

  await session.transport.handleRequest(req, res, body);
}