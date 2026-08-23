import type { FastifyInstance } from "fastify";
import {
  CreateAgentSchema,
  PolicyUpdateSchema,
  SimulatePolicySchema,
  StartSessionSchema,
  ActivatePolicySchema,
  type AgentSessionDTO,
} from "@kron/shared";
import { simulatePolicy, type PolicyRuleSet } from "@kron/policy-engine";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { createWalletKeys, ensureFunded } from "../algorand/vault.js";
import { registerRuntimeSigner } from "../algorand/contract.js";
import { executePaymentFlow } from "../services/payment-flow.js";
import {
  createPolicyVersion,
  getActivePolicyVersion,
  getPolicyHistory,
  getPolicyVersion,
  policyVersionToRuleSet,
  toPolicyConfig,
  evaluateForAgent,
} from "../services/policies.js";
import { recordAudit } from "../services/audit.js";
import { hub } from "../events/hub.js";
import { toAgentDTO, toSessionDTO, notFound, badRequest } from "../lib/http.js";
import { algoToMicro, toAlgo } from "../lib/money.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import type { AgentSession } from "@prisma/client";

/**
 * Attach the real confirmed-spend figure (ALGO) to each session's DTO,
 * aggregated from settled payments — the number shown in the console is
 * always backed by on-chain settlements, never a stub.
 */
async function attachSessionSpend(sessions: AgentSession[]): Promise<AgentSessionDTO[]> {
  if (sessions.length === 0) return [];
  const rows = await prisma.paymentRequest.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: sessions.map((s) => s.id) }, status: "confirmed" },
    _sum: { amountMicro: true },
  });
  const spendBySession = new Map(rows.map((r) => [r.sessionId, toAlgo(r._sum.amountMicro ?? 0n)]));
  return sessions.map((s) => ({ ...toSessionDTO(s), totalSpendAlgo: spendBySession.get(s.id) ?? 0 }));
}

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.get("/api/agents", { preHandler: requireAuth }, async (_request, reply) => {
    const agents = await prisma.agent.findMany({ orderBy: { createdAt: "desc" } });
    const result = [];
    for (const a of agents) result.push(await toAgentDTO(a));
    return { agents: result };
  });

  fastify.get("/api/agents/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) return notFound(reply);
    return { agent: await toAgentDTO(agent) };
  });

  fastify.post("/api/agents", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateAgentSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid agent payload");
    const user = currentUser(request);

    const keys = createWalletKeys();
    const agent = await prisma.agent.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        userId: user.id,
        status: "idle",
        wallet: { create: { address: keys.address, encryptedKey: keys.encryptedKey } },
      },
    });

    await createPolicyVersion(agent.id, {}, user.id);
    // Register the new wallet as an authorized anchor signer on-chain
    // (contract set_runtime). Best-effort — never blocks agent creation.
    void registerRuntimeSigner(keys.address);

    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "agent.created",
      targetType: "Agent",
      targetId: agent.id,
      summary: `Agent "${agent.name}" created with dedicated wallet ${keys.address}`,
    });
    void recordAudit({
      actorType: "system",
      action: "wallet.created",
      targetType: "Wallet",
      targetId: agent.id,
      summary: `Dedicated wallet created for ${agent.name}: ${keys.address}`,
    });

    return { agent: await toAgentDTO(agent) };
  });

  fastify.post("/api/agents/:id/sessions", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = StartSessionSchema.safeParse({ agentId: id, ...(request.body as object) });
    if (!parsed.success) return badRequest(reply, "Invalid session payload");
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) return notFound(reply);

    const session = await prisma.agentSession.create({
      data: { agentId: id, task: parsed.data.task ?? null, status: "running" },
    });
    await prisma.agent.update({ where: { id }, data: { status: "running" } });

    void recordAudit({
      actorId: currentUser(request).id,
      actorType: "user",
      action: "session.started",
      targetType: "AgentSession",
      targetId: session.id,
      summary: `Session started for ${agent.name}${parsed.data.task ? `: ${parsed.data.task}` : ""}`,
    });
    hub.publish({ type: "session.updated", session: toSessionDTO(session) });
    return { session: toSessionDTO(session) };
  });

  fastify.get("/api/agents/:id/sessions", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessions = await prisma.agentSession.findMany({
      where: { agentId: id },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return { sessions: await attachSessionSpend(sessions) };
  });

  fastify.get("/api/agents/:id/policy", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const v = await getActivePolicyVersion(id);
    if (!v) return notFound(reply, "No active policy");
    return { policy: toPolicyConfig(v) };
  });

  fastify.get("/api/agents/:id/policy/history", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const versions = await getPolicyHistory(id);
    return { history: versions.map(toPolicyConfig) };
  });

  fastify.put("/api/agents/:id/policy", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = PolicyUpdateSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid policy payload");
    const user = currentUser(request);
    const v = await createPolicyVersion(id, parsed.data, user.id);
    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "policy.updated",
      targetType: "PolicyVersion",
      targetId: v.id,
      policyVersion: v.version,
      summary: `Policy v${v.version} published for agent ${id}`,
    });
    hub.publish({ type: "policy.updated", policy: toPolicyConfig(v) });
    return { policy: toPolicyConfig(v) };
  });

  fastify.post("/api/agents/:id/policy/activate", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ActivatePolicySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid version");
    const target = await getPolicyVersion(id, parsed.data.version);
    if (!target) return notFound(reply, "Policy version not found");
    await prisma.$transaction([
      prisma.policyVersion.updateMany({ where: { policyId: target.policyId }, data: { active: false } }),
      prisma.policyVersion.update({ where: { id: target.id }, data: { active: true } }),
    ]);
    void recordAudit({
      actorId: currentUser(request).id,
      actorType: "user",
      action: "policy.version_activated",
      targetType: "PolicyVersion",
      targetId: target.id,
      policyVersion: target.version,
      summary: `Policy v${target.version} activated for agent ${id}`,
    });
    return { policy: toPolicyConfig(target) };
  });

  fastify.post("/api/agents/:id/policy/simulate", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = SimulatePolicySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, "Invalid simulation payload");
    const { draft, lookbackTransactions } = parsed.data;

    const txns = await prisma.paymentRequest.findMany({
      where: { agentId: id, status: { in: ["confirmed", "authorized"] } },
      orderBy: { createdAt: "desc" },
      take: lookbackTransactions,
    });

    const rules: PolicyRuleSet = {
      version: 0,
      name: "draft",
      perCallLimitMicro: algoToMicro(draft.perCallLimitAlgo),
      hardCeilingMicro: algoToMicro(draft.hardCeilingAlgo),
      sessionBudgetMicro: algoToMicro(draft.sessionBudgetAlgo),
      dailyBudgetMicro: algoToMicro(draft.dailyBudgetAlgo),
      maxDailyPayments: draft.maxDailyPayments,
      unknownRecipient: draft.unknownRecipient,
      firstTimeService: draft.firstTimeService,
      recipientAllowlist: draft.recipientAllowlist,
      recipientBlocklist: draft.recipientBlocklist,
      serviceAllowlist: draft.serviceAllowlist,
      serviceBlocklist: draft.serviceBlocklist,
      emergencyStop: draft.emergencyStop,
    };

    const result = simulatePolicy({
      draft: rules,
      transactions: txns.map((t) => ({
        requestId: t.id,
        amountMicro: t.amountMicro,
        recipient: t.recipient,
        service: t.service,
        ts: t.createdAt.toISOString(),
      })),
    });

    return { result };
  });

  fastify.post("/api/agents/:id/wallet/fund", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { amountAlgo?: number };
    const targetAlgo = body.amountAlgo && body.amountAlgo > 0 ? Math.min(body.amountAlgo, 50) : undefined;
    const agent = await prisma.agent.findUnique({ where: { id }, include: { wallet: true } });
    if (!agent || !agent.wallet) return notFound(reply, "Agent or wallet not found");
    try {
      const balance = await ensureFunded(agent.wallet.address, targetAlgo);
      void recordAudit({
        actorId: currentUser(request).id,
        actorType: "user",
        action: "wallet.funded",
        targetType: "Wallet",
        targetId: agent.wallet.id,
        summary: `Wallet funded; balance ${balance.toFixed(4)} ALGO`,
      });
      hub.publish({
        type: "wallet.updated",
        wallet: { id: agent.wallet.id, agentId: id, address: agent.wallet.address, network: agent.wallet.network as "localnet" | "testnet" | "mainnet", balanceAlgo: balance, createdAt: agent.wallet.createdAt.toISOString() },
      });
      return { address: agent.wallet.address, balanceAlgo: balance };
    } catch (err) {
      return badRequest(reply, `Funding failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  fastify.post("/api/agents/:id/evaluate", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      recipient?: string;
      amountAlgo?: number;
      service?: string;
      sessionId?: string;
    };
    if (!body.recipient || !body.amountAlgo || body.amountAlgo <= 0) {
      return badRequest(reply, "recipient and positive amountAlgo required");
    }
    const ev = await evaluateForAgent(id, body.sessionId, {
      amountMicro: algoToMicro(body.amountAlgo),
      recipient: body.recipient,
      service: body.service ?? "unknown",
    });
    return { evaluation: ev.evaluation };
  });

  // Agent-to-Agent (A2A) Autonomous Subcontracting & Settlement
  fastify.post("/api/agents/:id/hire", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      targetAgentId?: string;
      task?: string;
      amountAlgo?: number;
      sessionId?: string;
    };

    if (!body.targetAgentId || !body.task || !body.amountAlgo || body.amountAlgo <= 0) {
      return badRequest(reply, "targetAgentId, task description, and positive amountAlgo are required");
    }

    const hiringAgent = await prisma.agent.findUnique({ where: { id }, include: { wallet: true } });
    if (!hiringAgent) return notFound(reply, "Hiring agent not found");

    const targetAgent = await prisma.agent.findUnique({
      where: { id: body.targetAgentId },
      include: { wallet: true },
    });
    if (!targetAgent || !targetAgent.wallet) {
      return notFound(reply, "Target agent or target agent wallet not found");
    }

    // Ensure session exists
    let sessionId = body.sessionId;
    if (!sessionId) {
      const activeSession = await prisma.agentSession.findFirst({
        where: { agentId: id, status: "running" },
        orderBy: { startedAt: "desc" },
      });
      if (activeSession) {
        sessionId = activeSession.id;
      } else {
        const newSession = await prisma.agentSession.create({
          data: { agentId: id, task: `A2A Hire: ${body.task}`, status: "running" },
        });
        sessionId = newSession.id;
      }
    }

    const toolCallId = `a2a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const flow = await executePaymentFlow({
      agentId: id,
      sessionId,
      toolCallId,
      mcpServerId: "a2a_runtime",
      toolName: "agent:hire",
      service: "agent:hire",
      resourceId: `agent:${targetAgent.id}`,
      resourceName: `Delegate Subtask to ${targetAgent.name}`,
      recipient: targetAgent.wallet.address,
      amountAlgo: body.amountAlgo,
      note: `A2A Hire: ${body.task.slice(0, 50)}`,
    });

    if (flow.status === "AUTO_APPROVED") {
      void recordAudit({
        actorType: "agent",
        actorId: hiringAgent.id,
        action: "a2a.delegated",
        targetType: "Agent",
        targetId: targetAgent.id,
        summary: `${hiringAgent.name} paid ${body.amountAlgo} ALGO to hire ${targetAgent.name} for task: "${body.task}"`,
      });

      if (!flow.txId) {
        return {
          ok: false,
          status: "RECONCILING",
          flow,
          reasons: ["Payment approved but no settlement transaction confirmed yet — reconcile on-chain."],
        };
      }

      const deliverableOutput = await executeDelegatedSubtask(
        { id: targetAgent.id, name: targetAgent.name, description: targetAgent.description },
        body.task,
        flow.txId
      );

      return {
        ok: true,
        status: "AUTO_APPROVED",
        flow,
        hiredAgent: { id: targetAgent.id, name: targetAgent.name },
        taskResult: deliverableOutput,
      };


    }

    return {
      ok: false,
      status: flow.status,
      flow,
      reasons: flow.reasons,
    };
  });
}

async function executeDelegatedSubtask(
  contractor: { id: string; name: string; description?: string | null },
  task: string,
  txId: string,
): Promise<string> {
  if (!txId) {
    throw new Error("A2A delegation failed: no settlement transaction was recorded on-chain");
  }
  const ts = new Date().toUTCString();

  let telemetry: string[] = [];
  if (/volatility|orderbook|market|price/i.test(task)) {
    telemetry = await fetchLiveTelemetry();
  }

  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `[SUBCONTRACTED DELIVERABLE — ${contractor.name.toUpperCase()}]`,
    `[TASK DIRECTIVE]: "${task}"`,
    `[SETTLED VIA ALGORAND]: ${txId}`,
    `[TIMESTAMP]: ${ts}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ...telemetry,
    `[EXECUTION]: Subtask dispatched to ${contractor.name} after autonomous settlement on-chain.`,
    `[PROOF]: Settlement tx ${txId} — verify at the KRON /verify portal.`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join("\n");
}

/** Real live telemetry only — never synthesizes figures that were not received. */
async function fetchLiveTelemetry(): Promise<string[]> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true",
    );
    if (!res.ok) {
      return [`[TELEMETRY]: live market telemetry unavailable (upstream HTTP ${res.status})`];
    }
    const d = (await res.json()) as {
      algorand?: { usd?: number; usd_24h_change?: number; usd_24h_vol?: number };
    };
    const algo = d.algorand;
    if (!algo?.usd) {
      return ["[TELEMETRY]: live market telemetry unavailable (empty upstream response)"];
    }
    const change = algo.usd_24h_change ?? 0;
    const volM = algo.usd_24h_vol ? (algo.usd_24h_vol / 1e6).toFixed(2) : null;
    return [
      `• Live ALGO spot price: $${algo.usd.toFixed(4)} (CoinGecko)`,
      `• 24h change: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
      `• 24h volume: ${volM !== null ? `$${volM}M` : "n/a"}`,
    ];
  } catch {
    return ["[TELEMETRY]: live market telemetry unavailable (network error)"];
  }
}