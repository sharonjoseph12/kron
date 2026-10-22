/**
 * Demo reset endpoint â€” lets judges/one-click reset the offline demo
 * without wiping the DB. Clears payments/timeline but keeps agents/wallets/policies.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../lib/auth.js";
import { hub } from "../events/hub.js";
import { resetDemoState } from "../services/demo-reset.js";
import { runScenario, type ScenarioName } from "../services/scenarios.js";

export async function demoRoutes(fastify: FastifyInstance) {
  fastify.post("/api/demo/reset", { preHandler: requireAuth }, async (_req, reply) => {
    if (!config.demoMode && config.nodeEnv === "production") {
      return reply.code(403).send({ error: "Demo reset only allowed with DEMO_MODE=true" });
    }

    await resetDemoState();

    hub.publish({ type: "audit", entry: { id: `reset-${Date.now()}`, ts: new Date().toISOString(), actorId: null, actorType: "system", action: "demo.reset", targetType: "Demo", targetId: null, summary: "Demo reset â€” payments/timeline cleared, agents ready", detail: null, policyVersion: null } as unknown as never });

    return { ok: true, message: "Demo reset â€” agents, wallets and policies preserved; payments and timeline cleared." };
  });

  fastify.post("/api/demo/scenario", { preHandler: requireAuth }, async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; autoApprove?: boolean; reset?: boolean };
    const allowed: ScenarioName[] = ["hero", "delete", "baseline", "drift", "all"];
    if (!body.name || !allowed.includes(body.name as ScenarioName)) {
      return reply.code(400).send({ error: `name must be one of: ${allowed.join(", ")}` });
    }
    const { scenarios } = await runScenario(body.name as ScenarioName, {
      autoApprove: body.autoApprove === true,
      reset: body.reset !== false,
    });
    return { scenarios };
  });

  fastify.post("/api/demo/drift", { preHandler: requireAuth }, async (_request, reply) => {
    const { scenarios } = await runScenario("drift", { reset: true });
    const result = scenarios[0];
    if (!result?.drift) return reply.code(500).send({ error: "Drift scenario did not produce a proof" });
    return { drift: result.drift, scenario: result };
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
