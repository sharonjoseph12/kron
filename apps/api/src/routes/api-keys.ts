import type { FastifyInstance } from "fastify";
import type { ApiKey } from "@prisma/client";
import { prisma } from "../db.js";
import { recordAudit } from "../services/audit.js";
import { badRequest, notFound } from "../lib/http.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { generateApiKey, hashApiKey } from "../lib/api-keys.js";

export async function apiKeyRoutes(fastify: FastifyInstance) {
  fastify.get("/api/api-keys", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const keys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return { keys: keys.map(toApiKeyDTO) };
  });

  fastify.post("/api/api-keys", { preHandler: requireAuth }, async (request, reply) => {
    const user = currentUser(request);
    const body = request.body as { name?: string; agentId?: string; expiresInDays?: number };
    if (body.agentId !== undefined && typeof body.agentId !== "string") {
      return badRequest(reply, "agentId must be a string");
    }
    if (body.agentId) {
      const agent = await prisma.agent.findUnique({ where: { id: body.agentId } });
      if (!agent) return notFound(reply);
    }

    const raw = generateApiKey();
    const key = await prisma.apiKey.create({
      data: {
        keyHash: hashApiKey(raw),
        prefix: raw.slice(0, 8),
        name: typeof body.name === "string" ? body.name : null,
        agentId: body.agentId ?? null,
        userId: user.id,
        expiresAt:
          typeof body.expiresInDays === "number" && body.expiresInDays > 0
            ? new Date(Date.now() + body.expiresInDays * 86_400_000)
            : null,
      },
    });

    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "api.key.created",
      targetType: "ApiKey",
      targetId: key.id,
      summary: `Created API key ${key.name ?? key.prefix}${key.agentId ? ` for agent ${key.agentId}` : ""}`,
    });

    // The raw key is returned exactly once; it cannot be recovered later.
    return { key: { ...toApiKeyDTO(key), key: raw } };
  });

  fastify.delete("/api/api-keys/:id", { preHandler: requireAuth }, async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const updated = await prisma.apiKey.updateMany({
      where: { id, userId: user.id },
      data: { revoked: true },
    });
    if (updated.count === 0) return notFound(reply);
    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "api.key.revoked",
      targetType: "ApiKey",
      targetId: id,
      summary: "Revoked an API key",
    });
    return { ok: true };
  });
}

function toApiKeyDTO(key: ApiKey) {
  return {
    id: key.id,
    prefix: key.prefix,
    name: key.name,
    agentId: key.agentId,
    revoked: key.revoked,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}