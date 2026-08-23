/**
 * Demo reset endpoint â€” lets judges/one-click reset the offline demo
 * without wiping the DB. Clears payments/timeline but keeps agents/wallets/policies.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../lib/auth.js";
import { hub } from "../events/hub.js";

export async function demoRoutes(fastify: FastifyInstance) {
  fastify.post("/api/demo/reset", { preHandler: requireAuth }, async (_req, reply) => {
    if (!config.demoMode && config.nodeEnv === "production") {
      return reply.code(403).send({ error: "Demo reset only allowed with DEMO_MODE=true" });
    }

    // Keep agents/wallets/policies/mcpServers â€” only wipe ephemeral economic trace
    await prisma.settlement.deleteMany({});
    await prisma.escalation.deleteMany({});
    await prisma.paymentDecision.deleteMany({});
    await prisma.paymentRequest.deleteMany({});
    await prisma.timelineEvent.deleteMany({});
    await prisma.toolCall.deleteMany({});
    await prisma.auditEvent.deleteMany({ where: { action: { in: ["payment.decision", "payment.settled", "payment.blocked"] } } });
    // Reset sessions to idle so next demo starts clean
    await prisma.agentSession.updateMany({ data: { status: "idle" } });
    await prisma.agent.updateMany({ data: { status: "idle" } });

    hub.publish({ type: "audit", entry: { id: `reset-${Date.now()}`, ts: new Date().toISOString(), actorId: null, actorType: "system", action: "demo.reset", targetType: "Demo", targetId: null, summary: "Demo reset â€” payments/timeline cleared, agents ready", detail: null, policyVersion: null } as unknown as never });

    return { ok: true, message: "Demo reset â€” agents, wallets and policies preserved; payments and timeline cleared." };
  });

  fastify.get("/api/demo/status", { preHandler: requireAuth }, async (_req, _reply) => {
    const counts = {
      agents: await prisma.agent.count().catch(() => 0),
      wallets: await prisma.wallet.count().catch(() => 0),
      policies: await prisma.policyVersion.count().catch(() => 0),
      payments: await prisma.paymentRequest.count().catch(() => 0),
      settlements: await prisma.settlement.count().catch(() => 0),
    };
    return { demoMode: config.demoMode, network: config.algorandNetwork, ...counts };
  });
}
