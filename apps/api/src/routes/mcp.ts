import type { FastifyInstance, FastifyRequest } from "fastify";
import { CreateMCPServerSchema, MCPServerHealthSchema } from "@kron/shared";
import type { McpServer } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { encryptMnemonic } from "../algorand/vault.js";
import { callExternalTool, refreshMCPTools, toMCPServerDTO, type ToolOutcome } from "../mcp/gateway.js";
import { isSafeUrl } from "../lib/ssrf.js";
import { recordAudit } from "../services/audit.js";
import { badRequest, notFound } from "../lib/http.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { apiKeyFromRequest, currentApiKey, resolveApiKeyPrincipal, type ApiKeyPrincipal } from "../lib/api-keys.js";
import { hub } from "../events/hub.js";
import { handleKronMcpRequest } from "../mcp/kron-server.js";

export async function mcpRoutes(fastify: FastifyInstance) {
  // KRON's own MCP server — streamable HTTP endpoint for agent clients.
  // Authenticates with `Authorization: Bearer <agent-api-key>` when present;
  // anonymous sessions are allowed for backwards compatibility with local demos.
  const mcpAuth = async (request: FastifyRequest): Promise<boolean> => {
    const rawKey = apiKeyFromRequest(request);
    if (!rawKey) return true;
    const principal = await resolveApiKeyPrincipal(rawKey);
    if (!principal) return false;
    (request as FastifyRequest & { apiKey?: ApiKeyPrincipal }).apiKey = principal;
    void prisma.apiKey.updateMany({ where: { id: principal.keyId }, data: { lastUsedAt: new Date() } });
    return true;
  };

  const MCP_RATE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  fastify.post("/mcp", MCP_RATE_LIMIT, async (request, reply) => {
    if (!(await mcpAuth(request))) return reply.code(401).send({ error: "Invalid or revoked API key" });
    reply.hijack();
    await handleKronMcpRequest(request.raw, reply.raw, request.body, currentApiKey(request));
  });
  fastify.get("/mcp", MCP_RATE_LIMIT, async (request, reply) => {
    if (!(await mcpAuth(request))) return reply.code(401).send({ error: "Invalid or revoked API key" });
    reply.hijack();
    await handleKronMcpRequest(request.raw, reply.raw, undefined, currentApiKey(request));
  });
  fastify.delete("/mcp", MCP_RATE_LIMIT, async (request, reply) => {
    if (!(await mcpAuth(request))) return reply.code(401).send({ error: "Invalid or revoked API key" });
    reply.hijack();
    await handleKronMcpRequest(request.raw, reply.raw, undefined, currentApiKey(request));
  });

  fastify.get("/api/mcp/servers", { preHandler: requireAuth }, async (_request, reply) => {
    const servers = (await prisma.mcpServer.findMany({
      include: { tools: true },
      orderBy: { createdAt: "asc" },
    })) as unknown as McpServer[];
    return { servers: servers.map(toMCPServerDTO) };
  });

  fastify.post("/api/mcp/servers", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateMCPServerSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid MCP server payload");
    const safe = isSafeUrl(parsed.data.url);
    if (!safe.ok) return badRequest(reply, `SSRF blocked: ${safe.reason}`);
    const user = currentUser(request);

    const server = (await prisma.mcpServer.create({
      data: {
        name: parsed.data.name,
        url: parsed.data.url,
        transport: parsed.data.transport,
        authTokenEnc: parsed.data.authToken ? encryptMnemonic(parsed.data.authToken) : null,
      },
      include: { tools: true },
    })) as unknown as McpServer;

    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "mcp.server.created",
      targetType: "McpServer",
      targetId: server.id,
      summary: `Registered MCP server "${server.name}" at ${server.url}`,
    });
    return { server: toMCPServerDTO(server) };
  });

  fastify.get("/api/mcp/servers/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = (await prisma.mcpServer.findUnique({
      where: { id },
      include: { tools: true },
    })) as unknown as McpServer | null;
    if (!server) return notFound(reply);
    return { server: toMCPServerDTO(server) };
  });

  fastify.post("/api/mcp/servers/:id/test", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.mcpServer.findUnique({ where: { id } });
    if (!server) return notFound(reply);
    const result = await refreshMCPTools(server as unknown as McpServer);
    return { ok: result.ok, latencyMs: result.latencyMs, error: result.error, tools: result.tools.map((t) => t.name) };
  });

  fastify.post("/api/mcp/tools/call", { preHandler: requireAuth }, async (request, reply) => {
    const user = currentUser(request);
    const body = request.body as {
      serverId?: string;
      tool?: string;
      args?: Record<string, unknown>;
      agentId?: string;
      sessionId?: string;
      toolCallId?: string;
    };
    if (!body.serverId || !body.tool) return badRequest(reply, "serverId and tool required");
    if (!body.agentId) return badRequest(reply, "agentId required");

    const sessionId = body.sessionId ?? (await ensureSession(body.agentId)).id;
    const toolCallId = body.toolCallId ?? `tc_${Date.now()}`;

    await prisma.toolCall.create({
      data: { sessionId, mcpServerId: body.serverId, toolName: body.tool, arguments: (body.args ?? {}) as Prisma.InputJsonValue, status: "started" },
    });

    const outcome = (await callExternalTool({
      serverId: body.serverId,
      toolName: body.tool,
      args: body.args ?? {},
      trace: { agentId: body.agentId, sessionId, toolCallId },
    })) as ToolOutcome;

    await prisma.toolCall.updateMany({
      where: { sessionId, toolName: body.tool, status: "started" },
      data: {
        result: { content: outcome.content } as Prisma.InputJsonValue,
        isPaid: outcome.isPaid,
        error: outcome.error ?? null,
        status: outcome.ok ? "completed" : "failed",
        durationMs: null,
      },
    });

    hub.publish({
      type: "tool.call",
      event: {
        id: toolCallId,
        sessionId,
        toolName: body.tool,
        phase: outcome.ok ? "completed" : "failed",
        paid: outcome.isPaid,
        message: outcome.isPaid ? "Paid tool call delivered" : (outcome.error ?? "Tool call completed"),
        ts: new Date().toISOString(),
      },
    });

    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "payment.settled",
      targetType: "ToolCall",
      targetId: toolCallId,
      summary: outcome.isPaid ? `Manual tool call ${body.tool} paid ${outcome.payment.amountAlgo?.toFixed(4)} ALGO` : `Manual tool call ${body.tool}`,
      detail: { paid: outcome.isPaid, paymentStatus: outcome.payment.status },
    });
    return outcome;
  });

  fastify.get("/api/mcp/servers/:id/health", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = MCPServerHealthSchema.safeParse({ serverId: (request.params as { id: string }).id });
    if (!parsed.success) return badRequest(reply, "Invalid server id");
    const server = await prisma.mcpServer.findUnique({ where: { id: parsed.data.serverId } });
    if (!server) return notFound(reply);
    const result = await refreshMCPTools(server as unknown as McpServer);
    return { status: result.ok ? "healthy" : "offline", ...result };
  });
}

async function ensureSession(agentId: string): Promise<{ id: string }> {
  const open = await prisma.agentSession.findFirst({
    where: { agentId, status: "running" },
    orderBy: { startedAt: "desc" },
  });
  if (open) return open;
  throw new Error("No active session for agent — start one first");
}