import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.get("/api/audit", { preHandler: requireAuth }, async (request, reply) => {
    const q = request.query as { limit?: string; action?: string; actor?: string };
    const rows = await prisma.auditEvent.findMany({
      where: {
        action: q.action || undefined,
        actorId: q.actor || undefined,
      },
      orderBy: { ts: "desc" },
      take: Number(q.limit ?? 200),
    });
    return {
      entries: rows.map((e) => ({
        id: e.id,
        ts: e.ts.toISOString(),
        actorId: e.actorId,
        actorType: e.actorType,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        summary: e.summary,
        detail: e.detail,
        policyVersion: e.policyVersion,
      })),
    };
  });
}