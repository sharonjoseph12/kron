/**
 * One reset path for both the dashboard button and the CLI runner.
 * Keeps agents/wallets/policies; clears ephemeral economic trace, approvals,
 * action records, session taint and the hash-chained control audit.
 */
import { resetSandbox } from "@kron/business-tools";
import { prisma } from "../db.js";

export async function resetDemoState(): Promise<void> {
  await prisma.settlement.deleteMany({});
  await prisma.escalation.deleteMany({});
  await prisma.paymentDecision.deleteMany({});
  await prisma.paymentRequest.deleteMany({});
  await prisma.timelineEvent.deleteMany({});
  await prisma.toolCall.deleteMany({});
  await prisma.auditEvent.deleteMany({
    where: { action: { in: ["payment.decision", "payment.settled", "payment.blocked"] } },
  });
  // Seeded history is disposable; the cascade clears its tool calls/timeline.
  await prisma.agentSession.deleteMany({ where: { id: { startsWith: "demo-sess-" } } });
  await prisma.auditEvent.deleteMany({ where: { targetId: { startsWith: "demo-" } } });
  await prisma.agentSession.updateMany({ data: { status: "idle" } });
  await prisma.agent.updateMany({ data: { status: "idle" } });

  await prisma.approval.deleteMany({});
  await prisma.actionRecord.deleteMany({});
  await prisma.capabilityGrant.deleteMany({});
  await prisma.enforcementReceipt.deleteMany({});
  await prisma.actionSessionState.deleteMany({});
  await prisma.controlAuditEntry.deleteMany({});
  await resetSandbox();
}
