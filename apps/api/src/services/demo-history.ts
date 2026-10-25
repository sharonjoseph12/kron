/**
 * Seeded economic history for the judge-facing sandbox.
 *
 * The control room already ships with two live approvals. This module adds the
 * other half of the story: six completed agent sessions and 24 policy decisions
 * spread across the last two weeks, so the dashboard, payments table, agent
 * timelines and audit log are populated on a cold start.
 *
 * Everything here is sandbox data. Settlements are deliberately marked
 * `verified: false` and carry `demo-` transaction ids; the dashboard renders
 * them as "Sandbox" instead of claiming a public-ledger proof.
 */
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { algoToMicro } from "../lib/money.js";

const DAY_MS = 86_400_000;
const NETWORK = "testnet";

/** Merchant wallet shipped with the demo resource server (public demo key). */
const MERCHANT = "UPEVKAFBZMEY34GQOGIFZUNBO7V45MNTXCWZZNY5HDQFVCTMVGHN7E4J7A";

type DecisionKind = "AUTO_APPROVED" | "BLOCKED" | "ESCALATED";

interface RuleHit {
  rule: string;
  description: string;
  severity: "info" | "warn" | "block";
}

interface PaymentSpec {
  key: string;
  tool: string;
  service: string;
  resourceId: string;
  resourceName: string;
  amountAlgo: number;
  decision: DecisionKind;
  reason: string;
  rule?: RuleHit;
  latencyMs: number;
}

interface SessionSpec {
  key: string;
  agentName: string;
  task: string;
  dayOffset: number;
  hourUtc: number;
  minuteUtc: number;
  payments: PaymentSpec[];
}

const RESEARCH_PER_CALL = 0.02;
const TRADER_PER_CALL = 0.05;

function auto(key: string, spec: Omit<PaymentSpec, "key" | "decision" | "reason">, perCall: number): PaymentSpec {
  return {
    key,
    decision: "AUTO_APPROVED",
    reason: `Amount ${spec.amountAlgo.toFixed(4)} ALGO is within the ${perCall.toFixed(4)} ALGO per-call limit; recipient and service are known; session and daily budgets available.`,
    ...spec,
  };
}

const SESSIONS: SessionSpec[] = [
  {
    key: "research-supplier",
    agentName: "researcher-01",
    task: "Q3 supplier risk dossier",
    dayOffset: 12,
    hourUtc: 9,
    minuteUtc: 10,
    payments: [
      auto("r1-1", { tool: "market/report", service: "market", resourceId: "market/report", resourceName: "Premium Market Research Report", amountAlgo: 0.01, latencyMs: 3_400 }, RESEARCH_PER_CALL),
      auto("r1-2", { tool: "research/supplier-risk", service: "research", resourceId: "research/supplier-risk", resourceName: "Supplier Risk Dossier", amountAlgo: 0.018, latencyMs: 4_100 }, RESEARCH_PER_CALL),
      auto("r1-3", { tool: "market/sentiment", service: "market", resourceId: "market/sentiment", resourceName: "Institutional Sentiment Feed", amountAlgo: 0.015, latencyMs: 2_800 }, RESEARCH_PER_CALL),
      {
        key: "r1-4",
        tool: "research/supplier-risk",
        service: "research",
        resourceId: "research/supplier-risk",
        resourceName: "Supplier Risk Dossier",
        amountAlgo: 0.05,
        decision: "BLOCKED",
        reason: "Amount 0.0500 ALGO exceeds the 0.0200 ALGO per-call limit for researcher-01.",
        rule: { rule: "per_call_limit", description: "Requested amount is 2.5× the per-call limit.", severity: "block" },
        latencyMs: 900,
      },
    ],
  },
  {
    key: "research-apac",
    agentName: "researcher-01",
    task: "APAC competitor pricing sweep",
    dayOffset: 8,
    hourUtc: 14,
    minuteUtc: 5,
    payments: [
      auto("r2-1", { tool: "market/report", service: "market", resourceId: "market/report", resourceName: "Premium Market Research Report", amountAlgo: 0.01, latencyMs: 3_100 }, RESEARCH_PER_CALL),
      auto("r2-2", { tool: "market/sentiment", service: "market", resourceId: "market/sentiment", resourceName: "Institutional Sentiment Feed", amountAlgo: 0.015, latencyMs: 2_600 }, RESEARCH_PER_CALL),
      {
        key: "r2-3",
        tool: "research/supplier-risk",
        service: "research",
        resourceId: "research/supplier-risk",
        resourceName: "Supplier Risk Dossier",
        amountAlgo: 0.03,
        decision: "ESCALATED",
        reason: "Amount 0.0300 ALGO falls in the operator-review band for this run; routed to the approval queue instead of paying autonomously.",
        rule: { rule: "manual_review", description: "Above the autonomous comfort band; operator review requested.", severity: "warn" },
        latencyMs: 1_800,
      },
      auto("r2-4", { tool: "market/report", service: "market", resourceId: "market/report", resourceName: "Premium Market Research Report", amountAlgo: 0.01, latencyMs: 3_000 }, RESEARCH_PER_CALL),
    ],
  },
  {
    key: "research-compliance",
    agentName: "researcher-01",
    task: "Regulatory digest — compliance review",
    dayOffset: 3,
    hourUtc: 11,
    minuteUtc: 20,
    payments: [
      auto("r3-1", { tool: "market/report", service: "market", resourceId: "market/report", resourceName: "Premium Market Research Report", amountAlgo: 0.01, latencyMs: 3_600 }, RESEARCH_PER_CALL),
      auto("r3-2", { tool: "market/sentiment", service: "market", resourceId: "market/sentiment", resourceName: "Institutional Sentiment Feed", amountAlgo: 0.015, latencyMs: 2_900 }, RESEARCH_PER_CALL),
      auto("r3-3", { tool: "market/report", service: "market", resourceId: "market/report", resourceName: "Premium Market Research Report", amountAlgo: 0.01, latencyMs: 3_300 }, RESEARCH_PER_CALL),
      {
        key: "r3-4",
        tool: "trading/signals",
        service: "trading",
        resourceId: "trading/signals",
        resourceName: "Cross-Venue Arb Signals",
        amountAlgo: 0.015,
        decision: "BLOCKED",
        reason: 'Service "trading" is not allowlisted for researcher-01 (allowlist: market, research).',
        rule: { rule: "service_not_allowlisted", description: "Trading tools are outside this agent's mandate.", severity: "block" },
        latencyMs: 700,
      },
    ],
  },
  {
    key: "trader-momentum",
    agentName: "trader-01",
    task: "ALGO/USDC momentum scan",
    dayOffset: 13,
    hourUtc: 8,
    minuteUtc: 30,
    payments: [
      auto("t1-1", { tool: "market/report", service: "market", resourceId: "market/report", resourceName: "Premium Market Research Report", amountAlgo: 0.02, latencyMs: 2_700 }, TRADER_PER_CALL),
      auto("t1-2", { tool: "trading/signals", service: "trading", resourceId: "trading/signals", resourceName: "Cross-Venue Arb Signals", amountAlgo: 0.035, latencyMs: 1_900 }, TRADER_PER_CALL),
      auto("t1-3", { tool: "market/sentiment", service: "market", resourceId: "market/sentiment", resourceName: "Institutional Sentiment Feed", amountAlgo: 0.025, latencyMs: 2_400 }, TRADER_PER_CALL),
      {
        key: "t1-4",
        tool: "trading/venue-depth",
        service: "trading",
        resourceId: "trading/venue-depth",
        resourceName: "Venue Liquidity Depth",
        amountAlgo: 0.25,
        decision: "BLOCKED",
        reason: "Amount 0.2500 ALGO exceeds both the 0.0500 ALGO per-call limit and the 0.2000 ALGO hard ceiling.",
        rule: { rule: "hard_ceiling", description: "Requested amount is above the agent's hard ceiling.", severity: "block" },
        latencyMs: 600,
      },
    ],
  },
  {
    key: "trader-earnings",
    agentName: "trader-01",
    task: "Earnings-week sentiment arbitrage",
    dayOffset: 6,
    hourUtc: 15,
    minuteUtc: 40,
    payments: [
      auto("t2-1", { tool: "market/sentiment", service: "market", resourceId: "market/sentiment", resourceName: "Institutional Sentiment Feed", amountAlgo: 0.03, latencyMs: 2_100 }, TRADER_PER_CALL),
      auto("t2-2", { tool: "trading/signals", service: "trading", resourceId: "trading/signals", resourceName: "Cross-Venue Arb Signals", amountAlgo: 0.045, latencyMs: 1_700 }, TRADER_PER_CALL),
      {
        key: "t2-3",
        tool: "trading/venue-depth",
        service: "trading",
        resourceId: "trading/venue-depth",
        resourceName: "Venue Liquidity Depth",
        amountAlgo: 0.08,
        decision: "ESCALATED",
        reason: "Amount 0.0800 ALGO is above the autonomous-review threshold; held for operator sign-off.",
        rule: { rule: "manual_review", description: "High-value trade data requires a human decision.", severity: "warn" },
        latencyMs: 1_400,
      },
      auto("t2-4", { tool: "market/report", service: "market", resourceId: "market/report", resourceName: "Premium Market Research Report", amountAlgo: 0.02, latencyMs: 2_500 }, TRADER_PER_CALL),
    ],
  },
  {
    key: "trader-rebalance",
    agentName: "trader-01",
    task: "Venue liquidity rebalance",
    dayOffset: 0,
    hourUtc: 10,
    minuteUtc: 5,
    payments: [
      auto("t3-1", { tool: "trading/venue-depth", service: "trading", resourceId: "trading/venue-depth", resourceName: "Venue Liquidity Depth", amountAlgo: 0.04, latencyMs: 1_800 }, TRADER_PER_CALL),
      {
        key: "t3-2",
        tool: "trading/venue-depth",
        service: "trading",
        resourceId: "trading/venue-depth",
        resourceName: "Venue Liquidity Depth",
        amountAlgo: 0.2,
        decision: "BLOCKED",
        reason: "Amount 0.2000 ALGO exceeds the 0.0500 ALGO per-call limit for trader-01.",
        rule: { rule: "per_call_limit", description: "Requested amount is 4× the per-call limit.", severity: "block" },
        latencyMs: 500,
      },
      auto("t3-3", { tool: "trading/signals", service: "trading", resourceId: "trading/signals", resourceName: "Cross-Venue Arb Signals", amountAlgo: 0.035, latencyMs: 1_600 }, TRADER_PER_CALL),
      auto("t3-4", { tool: "market/sentiment", service: "market", resourceId: "market/sentiment", resourceName: "Institutional Sentiment Feed", amountAlgo: 0.025, latencyMs: 2_200 }, TRADER_PER_CALL),
    ],
  },
];

function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function utcDayStart(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function demoTxId(key: string): string {
  return `demo-${crypto.createHash("sha256").update(`kron-demo-${key}`).digest("hex").slice(0, 24)}`;
}

export interface DemoHistorySummary {
  sessions: number;
  payments: number;
  autoApproved: number;
  blocked: number;
  escalated: number;
  simulatedSettlements: number;
  timelineEvents: number;
  auditEvents: number;
}

/**
 * Replace the sandbox's seeded payment history. Agents, wallets and policies
 * are preserved; only rows with `demo-` ids written by this module are removed.
 */
export async function seedDemoHistory(now = new Date()): Promise<DemoHistorySummary> {
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("Cannot seed demo history without an admin operator");

  // Idempotent: session cascade removes its payments, tool calls and timeline.
  await prisma.agentSession.deleteMany({ where: { id: { startsWith: "demo-sess-" } } });
  await prisma.auditEvent.deleteMany({ where: { targetId: { startsWith: "demo-" } } });

  const dayStart = utcDayStart(now);
  let seqSessions = 0;
  let seqPayments = 0;
  let timelineTotal = 0;

  const auditRows: Array<{
    ts: Date;
    actorId: string | null;
    actorType: string;
    action: string;
    targetType: string;
    targetId: string;
    summary: string;
    detail: object;
    policyVersion: number | null;
  }> = [];

  const summary: DemoHistorySummary = {
    sessions: 0,
    payments: 0,
    autoApproved: 0,
    blocked: 0,
    escalated: 0,
    simulatedSettlements: 0,
    timelineEvents: 0,
    auditEvents: 0,
  };

  for (const spec of SESSIONS) {
    const agent = await prisma.agent.findFirst({
      where: { name: spec.agentName },
      include: { wallet: true, policies: { include: { versions: { orderBy: { version: "desc" } } } } },
    });
    if (!agent?.wallet) {
      console.warn(`[demo-history] skipping ${spec.key}: agent ${spec.agentName} has no wallet`);
      continue;
    }
    const policyVersion = agent.policies[0]?.versions.find((v) => v.active) ?? agent.policies[0]?.versions[0];
    if (!policyVersion) {
      console.warn(`[demo-history] skipping ${spec.key}: agent ${spec.agentName} has no policy`);
      continue;
    }

    seqSessions += 1;
    const sessionId = `demo-sess-${spec.key}`;
    const startedAt = new Date(dayStart - spec.dayOffset * DAY_MS + spec.hourUtc * 3_600_000 + spec.minuteUtc * 60_000);
    const lastPaymentAt = startedAt.getTime() + (spec.payments.length - 1) * 120_000;

    await prisma.agentSession.create({
      data: {
        id: sessionId,
        agentId: agent.id,
        task: spec.task,
        status: "completed",
        startedAt,
        endedAt: new Date(lastPaymentAt + 180_000),
      },
    });
    summary.sessions += 1;
    let seqTimeline = 0;

    auditRows.push({
      ts: startedAt,
      actorId: agent.id,
      actorType: "agent",
      action: "session.started",
      targetType: "AgentSession",
      targetId: sessionId,
      summary: `${agent.name} started "${spec.task}"`,
      detail: { demo: true, task: spec.task },
      policyVersion: policyVersion.version,
    });

    for (const [index, payment] of spec.payments.entries()) {
      seqPayments += 1;
      const paymentId = `demo-pay-${payment.key}`;
      const decisionId = `demo-dec-${payment.key}`;
      const toolCallId = `demo-tc-${payment.key}`;
      const createdAt = new Date(startedAt.getTime() + index * 120_000);
      const amountMicro = algoToMicro(payment.amountAlgo);
      const status = payment.decision === "AUTO_APPROVED" ? "confirmed" : "blocked";
      const rules = payment.rule ? [payment.rule] : [];
      const reasons = [payment.reason];

      await prisma.paymentRequest.create({
        data: {
          id: paymentId,
          clientRequestId: `demo-req-${payment.key}`,
          agentId: agent.id,
          sessionId,
          toolCallId,
          service: payment.service,
          resourceId: payment.resourceId,
          resourceName: payment.resourceName,
          recipient: MERCHANT,
          amountMicro,
          network: NETWORK,
          note: "Seeded sandbox history — not a live settlement.",
          status,
          createdAt,
          updatedAt: new Date(createdAt.getTime() + payment.latencyMs),
        },
      });

      await prisma.toolCall.create({
        data: {
          id: toolCallId,
          sessionId,
          toolName: payment.tool,
          arguments: { resourceId: payment.resourceId, amountAlgo: payment.amountAlgo } as object,
          result: { summary: payment.reason, demo: true } as object,
          isPaid: true,
          paymentId,
          durationMs: payment.latencyMs,
          status: payment.decision === "AUTO_APPROVED" ? "completed" : "failed",
          createdAt,
        },
      });

      await prisma.paymentDecision.create({
        data: {
          id: decisionId,
          paymentId,
          decision: payment.decision,
          reasons: reasons as object,
          rulesTriggered: rules as object,
          policyVersionId: policyVersion.id,
          policyVersionNumber: policyVersion.version,
          createdAt,
        },
      });

      if (payment.decision === "AUTO_APPROVED") {
        summary.autoApproved += 1;
        summary.simulatedSettlements += 1;
        const round = 58_000_000 + spec.dayOffset * 10_000 + seqPayments;
        await prisma.settlement.create({
          data: {
            paymentId,
            txId: demoTxId(payment.key),
            round,
            sender: agent.wallet.address,
            recipient: MERCHANT,
            amountMicro,
            network: NETWORK,
            verified: false,
            appId: null,
            policyHash: null,
            appCallTxId: null,
            confirmedAt: new Date(createdAt.getTime() + payment.latencyMs),
          },
        });

        await prisma.timelineEvent.createMany({
          data: [
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "REQUEST", status: "pending", message: `Agent requests paid resource: ${payment.resourceName}`, ts: createdAt },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "402_DETECTED", status: "pending", message: "402 Payment Required detected", ts: new Date(createdAt.getTime() + 900) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "PRICE_DISCOVERED", status: "pending", message: `Cost: ${payment.amountAlgo.toFixed(4)} ALGO to ${shortAddr(MERCHANT)}`, ts: new Date(createdAt.getTime() + 1_500) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "POLICY_EVALUATED", status: "pending", message: "Evaluating against economic policy…", ts: new Date(createdAt.getTime() + 2_000) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "AUTHORIZED", status: "confirmed", message: payment.reason, ts: new Date(createdAt.getTime() + 2_400) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "CONFIRMED", status: "confirmed", message: `Settled in the seeded sandbox snapshot (simulated round ${round})`, detail: { demo: true, simulatedRound: round }, ts: new Date(createdAt.getTime() + payment.latencyMs) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "RESOURCE_DELIVERED", status: "confirmed", message: `${payment.resourceName} delivered to agent`, ts: new Date(createdAt.getTime() + payment.latencyMs + 400) },
          ],
        });
      } else if (payment.decision === "BLOCKED") {
        summary.blocked += 1;
        await prisma.timelineEvent.createMany({
          data: [
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "REQUEST", status: "pending", message: `Agent requests paid resource: ${payment.resourceName}`, ts: createdAt },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "402_DETECTED", status: "pending", message: "402 Payment Required detected", ts: new Date(createdAt.getTime() + 900) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "PRICE_DISCOVERED", status: "pending", message: `Cost: ${payment.amountAlgo.toFixed(4)} ALGO`, ts: new Date(createdAt.getTime() + 1_500) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "POLICY_EVALUATED", status: "pending", message: "Evaluating against economic policy…", ts: new Date(createdAt.getTime() + 1_900) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "BLOCKED", status: "blocked", message: payment.reason, detail: { reasons }, ts: new Date(createdAt.getTime() + 2_200) },
          ],
        });
        auditRows.push({
          ts: new Date(createdAt.getTime() + 2_200),
          actorId: agent.id,
          actorType: "agent",
          action: "payment.blocked",
          targetType: "PaymentRequest",
          targetId: paymentId,
          summary: `Blocked: ${payment.reason}`,
          detail: { demo: true, reasons },
          policyVersion: policyVersion.version,
        });
      } else {
        summary.escalated += 1;
        await prisma.escalation.create({
          data: {
            paymentId,
            decisionId,
            status: "denied",
            summary: payment.reason,
            expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
            decidedBy: admin.id,
            decidedAt: new Date(createdAt.getTime() + 90_000),
            createdAt,
          },
        });
        await prisma.timelineEvent.createMany({
          data: [
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "REQUEST", status: "pending", message: `Agent requests paid resource: ${payment.resourceName}`, ts: createdAt },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "402_DETECTED", status: "pending", message: "402 Payment Required detected", ts: new Date(createdAt.getTime() + 900) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "PRICE_DISCOVERED", status: "pending", message: `Cost: ${payment.amountAlgo.toFixed(4)} ALGO`, ts: new Date(createdAt.getTime() + 1_500) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "POLICY_EVALUATED", status: "pending", message: "Evaluating against economic policy…", ts: new Date(createdAt.getTime() + 1_900) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "ESCALATED", status: "pending", message: payment.reason, ts: new Date(createdAt.getTime() + 2_100) },
            { sessionId, agentId: agent.id, seq: ++seqTimeline, step: "BLOCKED", status: "blocked", message: "Operator denied the escalation; nothing was paid.", ts: new Date(createdAt.getTime() + 90_000) },
          ],
        });
        auditRows.push({
          ts: new Date(createdAt.getTime() + 2_100),
          actorId: agent.id,
          actorType: "agent",
          action: "payment.decision",
          targetType: "PaymentRequest",
          targetId: paymentId,
          summary: `ESCALATED ${payment.amountAlgo.toFixed(4)} ALGO to ${shortAddr(MERCHANT)} (${payment.resourceName})`,
          detail: { demo: true, reasons },
          policyVersion: policyVersion.version,
        });
        auditRows.push({
          ts: new Date(createdAt.getTime() + 90_000),
          actorId: admin.id,
          actorType: "user",
          action: "payment.blocked",
          targetType: "PaymentRequest",
          targetId: paymentId,
          summary: `Operator denied escalation — ${payment.resourceName} not purchased`,
          detail: { demo: true, reasons: ["Denied by operator"] },
          policyVersion: policyVersion.version,
        });
      }

      summary.payments += 1;
      if (payment.decision === "AUTO_APPROVED") {
        auditRows.push({
          ts: new Date(createdAt.getTime() + payment.latencyMs),
          actorId: null,
          actorType: "system",
          action: "payment.settled",
          targetType: "Settlement",
          targetId: `demo-settlement-${payment.key}`,
          summary: `Sandbox settlement recorded: ${payment.amountAlgo.toFixed(4)} ALGO (${payment.resourceName}) — simulated, no live transaction`,
          detail: { demo: true, recipient: MERCHANT, simulated: true },
          policyVersion: policyVersion.version,
        });
      }
      auditRows.push({
        ts: createdAt,
        actorId: agent.id,
        actorType: "agent",
        action: "payment.decision",
        targetType: "PaymentRequest",
        targetId: paymentId,
        summary: `${payment.decision} ${payment.amountAlgo.toFixed(4)} ALGO to ${shortAddr(MERCHANT)} (${payment.resourceName})`,
        detail: { demo: true, reasons, rules },
        policyVersion: policyVersion.version,
      });
    }

    timelineTotal += seqTimeline;
  }

  if (auditRows.length > 0) {
    await prisma.auditEvent.createMany({ data: auditRows });
  }
  summary.auditEvents = auditRows.length;
  summary.timelineEvents = timelineTotal;

  return summary;
}
