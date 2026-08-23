import type { FastifyInstance } from "fastify";
import type { DecisionSlice } from "@kron/shared";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { requireAuth } from "../lib/auth.js";

function toAlgo(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

const dayStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/analytics/overview", { preHandler: requireAuth }, async (_request, reply) => {
    const [agents, servers, payments] = await Promise.all([
      prisma.agent.count(),
      prisma.mcpServer.count({ where: { status: "healthy" } }),
      prisma.paymentRequest.findMany({
        select: {
          status: true,
          amountMicro: true,
          createdAt: true,
          updatedAt: true,
          decision: { select: { decision: true } },
        },
      }),
    ]);

    let walletBalanceAlgo = 0;
    const walletAddresses = (await prisma.wallet.findMany({ select: { address: true } })).map((w) => w.address);
    await Promise.all(
      walletAddresses.map(async (a) => {
        try {
          walletBalanceAlgo += await algorand.getBalanceAlgo(a);
        } catch {
          /* offline chain */
        }
      }),
    );

    let totalSpendMicro = 0n;
    let totalPayments = 0;
    let confirmed = 0;
    let autoApproved = 0;
    let escalated = 0;
    let blocked = 0;
    let latencySum = 0;
    let latencyCount = 0;
    const todayStart = dayStart(new Date()).getTime();
    let todaySpendMicro = 0n;

    for (const p of payments) {
      totalPayments += 1;
      if (p.status === "confirmed" || p.status === "authorized") {
        confirmed += 1;
        totalSpendMicro += p.amountMicro;
        if (p.createdAt.getTime() >= todayStart) todaySpendMicro += p.amountMicro;
        latencySum += Math.max(0, p.updatedAt.getTime() - p.createdAt.getTime());
        latencyCount += 1;
      }
      const d = p.decision?.decision;
      if (d === "AUTO_APPROVED") autoApproved += 1;
      else if (d === "ESCALATED") escalated += 1;
      else if (d === "BLOCKED") blocked += 1;
    }

    const totalSpendAlgo = toAlgo(totalSpendMicro);
    const todaySpendAlgo = toAlgo(todaySpendMicro);
    const firstPayment = payments.length > 0 ? Math.min(...payments.map((p) => p.createdAt.getTime())) : Date.now();
    const daysActive = Math.max(1, (Date.now() - firstPayment) / 86_400_000);
    const burnRateAlgoPerDay = totalSpendAlgo / daysActive;
    const estimatedWalletDays = burnRateAlgoPerDay > 0 ? walletBalanceAlgo / burnRateAlgoPerDay : null;

    return {
      overview: {
        activeAgents: agents,
        healthyMcpServers: servers,
        walletBalanceAlgo,
        todaySpendAlgo,
        totalSpendAlgo,
        totalPayments,
        autoApproved,
        escalated,
        blocked,
        approvalRatePct: totalPayments > 0 ? (autoApproved / totalPayments) * 100 : 0,
        paymentSuccessRatePct: totalPayments > 0 ? (confirmed / totalPayments) * 100 : 0,
        avgPaymentLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
        burnRateAlgoPerDay,
        estimatedWalletDays,
      },
    };
  });

  fastify.get("/api/analytics/spend", { preHandler: requireAuth }, async (_request, reply) => {
    const days = 14;
    const payments = await prisma.paymentRequest.findMany({
      where: { status: { in: ["confirmed", "authorized"] } },
      select: { amountMicro: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const points = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86_400_000);
      const start = dayStart(d).getTime();
      const end = start + 86_400_000;
      const algo = payments
        .filter((p) => p.createdAt.getTime() >= start && p.createdAt.getTime() < end)
        .reduce((s, p) => s + toAlgo(p.amountMicro), 0);
      return { ts: d.toISOString().slice(0, 10), algo };
    });
    return { points };
  });

  fastify.get("/api/analytics/decisions", { preHandler: requireAuth }, async (_request, reply) => {
    const payments = await prisma.paymentRequest.findMany({
      select: { decision: { select: { decision: true } } },
    });
    const tally: Record<string, number> = { AUTO_APPROVED: 0, ESCALATED: 0, BLOCKED: 0 };
    for (const p of payments) {
      const d = p.decision?.decision;
      if (typeof d === "string" && d in tally) tally[d] = (tally[d] ?? 0) + 1;
    }
    const slices: DecisionSlice[] = (
      Object.entries(tally) as [DecisionSlice["decision"], number][]
    ).map(([decision, count]) => ({ decision, count }));
    return { slices };
  });

  fastify.get("/api/analytics/agents-spend", { preHandler: requireAuth }, async (_request, reply) => {
    const confirmed = await prisma.paymentRequest.findMany({
      where: { status: { in: ["confirmed", "authorized"] } },
      select: { agentId: true, amountMicro: true, agent: { select: { name: true } } },
    });
    const map = new Map<string, { agentId: string; agentName: string; spendAlgo: number; payments: number }>();
    for (const p of confirmed) {
      const row = map.get(p.agentId) ?? { agentId: p.agentId, agentName: p.agent.name, spendAlgo: 0, payments: 0 };
      row.spendAlgo += toAlgo(p.amountMicro);
      row.payments += 1;
      map.set(p.agentId, row);
    }
    return { rows: [...map.values()].sort((a, b) => b.spendAlgo - a.spendAlgo) };
  });

  fastify.get("/api/analytics/burn-rate", { preHandler: requireAuth }, async (_request, reply) => {
    const confirmed = await prisma.paymentRequest.findMany({
      where: { status: { in: ["confirmed", "authorized"] } },
      select: { amountMicro: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const totalSpendAlgo = confirmed.reduce((s, p) => s + toAlgo(p.amountMicro), 0);
    let walletBalanceAlgo = 0;
    const walletAddresses = (await prisma.wallet.findMany({ select: { address: true } })).map((w) => w.address);
    await Promise.all(
      walletAddresses.map(async (a) => {
        try {
          walletBalanceAlgo += await algorand.getBalanceAlgo(a);
        } catch {
          /* offline chain */
        }
      }),
    );
    const first = confirmed[0]?.createdAt.getTime() ?? Date.now();
    const days = Math.max(1, (Date.now() - first) / 86_400_000);
    const burnRateAlgoPerDay = totalSpendAlgo / days;
    return {
      burnRate: {
        walletBalanceAlgo,
        burnRateAlgoPerDay,
        estimatedDays: burnRateAlgoPerDay > 0 ? walletBalanceAlgo / burnRateAlgoPerDay : null,
      },
    };
  });

  fastify.get("/api/analytics/timeline/:sessionId", { preHandler: requireAuth }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const events = await prisma.timelineEvent.findMany({
      where: { sessionId },
      orderBy: { seq: "asc" },
    });
    return {
      events: events.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        agentId: e.agentId,
        seq: e.seq,
        step: e.step,
        status: e.status,
        message: e.message,
        detail: e.detail,
        ts: e.ts.toISOString(),
      })),
    };
  });
}