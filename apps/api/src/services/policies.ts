/**
 * Policy service — persistence + evaluation glue.
 * Converts stored PolicyVersion rows into the engine's PolicyRuleSet and
 * computes spend/trust context from Postgres before calling the engine.
 */
import type {
  PolicyConfig,
  PolicyEvaluation,
  PolicyUpdateInput,
} from "@kron/shared";
import { DEFAULT_POLICY } from "@kron/shared";
import { evaluatePayment, type PolicyRuleSet } from "@kron/policy-engine";
import { prisma } from "../db.js";
import { algoToMicro, toAlgo } from "../lib/money.js";
import type { PolicyVersion } from "@prisma/client";

export function policyVersionToRuleSet(v: PolicyVersion): PolicyRuleSet {
  return {
    version: v.version,
    name: v.name,
    perCallLimitMicro: v.perCallLimitMicro,
    hardCeilingMicro: v.hardCeilingMicro,
    sessionBudgetMicro: v.sessionBudgetMicro,
    dailyBudgetMicro: v.dailyBudgetMicro,
    maxDailyPayments: v.maxDailyPayments,
    unknownRecipient: v.unknownRecipient as "block" | "escalate" | "allow",
    firstTimeService: v.firstTimeService as "block" | "escalate" | "allow",
    recipientAllowlist: (v.recipientAllowlist as string[]) ?? [],
    recipientBlocklist: (v.recipientBlocklist as string[]) ?? [],
    serviceAllowlist: (v.serviceAllowlist as string[]) ?? [],
    serviceBlocklist: (v.serviceBlocklist as string[]) ?? [],
    emergencyStop: v.emergencyStop,
  };
}

export async function getActivePolicyVersion(agentId: string): Promise<PolicyVersion | null> {
  const policy = await prisma.policy.findUnique({ where: { id: agentId } });
  if (!policy) return null;
  return prisma.policyVersion.findFirst({
    where: { policyId: policy.id, active: true },
    orderBy: { version: "desc" },
  });
}

export async function getPolicyVersion(agentId: string, version: number): Promise<PolicyVersion | null> {
  const policy = await prisma.policy.findUnique({ where: { id: agentId } });
  if (!policy) return null;
  return prisma.policyVersion.findUnique({
    where: { policyId_version: { policyId: policy.id, version } },
  });
}

export async function getPolicyHistory(agentId: string): Promise<PolicyVersion[]> {
  const policy = await prisma.policy.findUnique({ where: { id: agentId } });
  if (!policy) return [];
  return prisma.policyVersion.findMany({
    where: { policyId: policy.id },
    orderBy: { version: "desc" },
  });
}

/** Spend / trust facts for an agent, from confirmed payments. */
export async function buildContext(agentId: string, sessionId?: string) {
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);
  const confirmed = await prisma.paymentRequest.findMany({
    where: {
      agentId,
      status: { in: ["confirmed", "authorized"] },
    },
    select: { amountMicro: true, recipient: true, service: true, sessionId: true, createdAt: true },
  });

  let sessionSpendMicro = 0n;
  let dailySpendMicro = 0n;
  let dailyPaymentCount = 0;
  const knownRecipients = new Set<string>();
  const knownServices = new Set<string>();

  for (const p of confirmed) {
    knownRecipients.add(p.recipient.toLowerCase());
    knownServices.add(p.service);
    if (sessionId && p.sessionId === sessionId) sessionSpendMicro += p.amountMicro;
    if (p.createdAt >= since24h) {
      dailySpendMicro += p.amountMicro;
      dailyPaymentCount += 1;
    }
  }

  return {
    sessionSpendMicro,
    dailySpendMicro,
    dailyPaymentCount,
    knownRecipients,
    knownServices,
  };
}

/** Evaluate a payment request against the agent's active policy version. */
export async function evaluateForAgent(
  agentId: string,
  sessionId: string | undefined,
  request: { amountMicro: bigint; recipient: string; service: string },
): Promise<{ evaluation: PolicyEvaluation; policyVersion: PolicyVersion | null }> {
  const policy = await getActivePolicyVersion(agentId);
  if (!policy) {
    throw new Error("No active policy configured for this agent");
  }
  const ctx = await buildContext(agentId, sessionId);
  const evaluation = evaluatePayment(policyVersionToRuleSet(policy), request, ctx);
  return { evaluation, policyVersion: policy };
}

export interface CreatePolicyInput extends PolicyUpdateInput {}

/** Create a new policy version (v+1) and activate it; deactivate the old one. */
export async function createPolicyVersion(
  agentId: string,
  input: CreatePolicyInput,
  byUserId?: string,
): Promise<PolicyVersion> {
  const policy =
    (await prisma.policy.findUnique({ where: { id: agentId } })) ??
    (await prisma.policy.create({ data: { id: agentId, agentId } }));

  const latest = await prisma.policyVersion.findFirst({
    where: { policyId: policy.id },
    orderBy: { version: "desc" },
  });

  const prev = latest
    ? policyVersionToRuleSet(latest)
    : {
        version: 0,
        name: DEFAULT_POLICY.name,
        perCallLimitMicro: algoToMicro(DEFAULT_POLICY.perCallLimitAlgo),
        hardCeilingMicro: algoToMicro(DEFAULT_POLICY.hardCeilingAlgo),
        sessionBudgetMicro: algoToMicro(DEFAULT_POLICY.sessionBudgetAlgo),
        dailyBudgetMicro: algoToMicro(DEFAULT_POLICY.dailyBudgetAlgo),
        maxDailyPayments: DEFAULT_POLICY.maxDailyPayments,
        unknownRecipient: DEFAULT_POLICY.unknownRecipient,
        firstTimeService: DEFAULT_POLICY.firstTimeService,
        recipientAllowlist: DEFAULT_POLICY.recipientAllowlist,
        recipientBlocklist: DEFAULT_POLICY.recipientBlocklist,
        serviceAllowlist: DEFAULT_POLICY.serviceAllowlist,
        serviceBlocklist: DEFAULT_POLICY.serviceBlocklist,
        emergencyStop: DEFAULT_POLICY.emergencyStop,
      };

  const next = {
    version: prev.version + 1,
    name: input.name ?? prev.name,
    perCallLimitMicro: input.perCallLimitAlgo != null ? algoToMicro(input.perCallLimitAlgo) : prev.perCallLimitMicro,
    hardCeilingMicro: input.hardCeilingAlgo != null ? algoToMicro(input.hardCeilingAlgo) : prev.hardCeilingMicro,
    sessionBudgetMicro: input.sessionBudgetAlgo != null ? algoToMicro(input.sessionBudgetAlgo) : prev.sessionBudgetMicro,
    dailyBudgetMicro: input.dailyBudgetAlgo != null ? algoToMicro(input.dailyBudgetAlgo) : prev.dailyBudgetMicro,
    maxDailyPayments: input.maxDailyPayments ?? prev.maxDailyPayments,
    unknownRecipient: input.unknownRecipient ?? prev.unknownRecipient,
    firstTimeService: input.firstTimeService ?? prev.firstTimeService,
    recipientAllowlist: input.recipientAllowlist ?? prev.recipientAllowlist,
    recipientBlocklist: input.recipientBlocklist ?? prev.recipientBlocklist,
    serviceAllowlist: input.serviceAllowlist ?? prev.serviceAllowlist,
    serviceBlocklist: input.serviceBlocklist ?? prev.serviceBlocklist,
    emergencyStop: input.emergencyStop ?? prev.emergencyStop,
    createdBy: byUserId ?? null,
    active: true,
  };

  await prisma.$transaction([
    prisma.policyVersion.updateMany({
      where: { policyId: policy.id },
      data: { active: false },
    }),
    prisma.policyVersion.create({ data: { policyId: policy.id, ...next } }),
  ]);

  return prisma.policyVersion.findFirst({
    where: { policyId: policy.id, version: next.version },
  }) as Promise<PolicyVersion>;
}

/** Convert a stored version to the shared PolicyConfig DTO. */
export function toPolicyConfig(v: PolicyVersion): PolicyConfig {
  return {
    id: v.policyId,
    version: v.version,
    name: v.name,
    perCallLimitAlgo: toAlgo(v.perCallLimitMicro),
    hardCeilingAlgo: toAlgo(v.hardCeilingMicro),
    sessionBudgetAlgo: toAlgo(v.sessionBudgetMicro),
    dailyBudgetAlgo: toAlgo(v.dailyBudgetMicro),
    maxDailyPayments: v.maxDailyPayments,
    unknownRecipient: v.unknownRecipient as PolicyConfig["unknownRecipient"],
    firstTimeService: v.firstTimeService as PolicyConfig["firstTimeService"],
    recipientAllowlist: (v.recipientAllowlist as string[]) ?? [],
    recipientBlocklist: (v.recipientBlocklist as string[]) ?? [],
    serviceAllowlist: (v.serviceAllowlist as string[]) ?? [],
    serviceBlocklist: (v.serviceBlocklist as string[]) ?? [],
    emergencyStop: v.emergencyStop,
    active: v.active,
    createdAt: v.createdAt.toISOString(),
  };
}
