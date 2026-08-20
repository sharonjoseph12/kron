/**
 * demo:reset — wipe all demo runtime data for a clean hackathon slate.
 * Deletes tool calls, settlements, escalations, payments, timeline events,
 * MCP servers/tools, sessions and agents. Keeps the admin user.
 * Run via: pnpm --filter @kron/api demo:reset
 */
import { prisma } from "../src/db.js";

async function main() {
  const counts: Record<string, number> = {};
  const del = async (name: string, table: () => Promise<{ count: number }>) => {
    counts[name] = (await table()).count;
  };

  await del("toolCalls", () => prisma.toolCall.deleteMany({}));
  await del("settlements", () => prisma.settlement.deleteMany({}));
  await del("escalations", () => prisma.escalation.deleteMany({}));
  await del("payments", () => prisma.paymentRequest.deleteMany({}));
  await del("timelineEvents", () => prisma.timelineEvent.deleteMany({}));
  await del("mcpTools", () => prisma.mcpTool.deleteMany({}));
  await del("mcpServers", () => prisma.mcpServer.deleteMany({}));
  await del("sessions", () => prisma.agentSession.deleteMany({}));
  await del("policyVersions", () => prisma.policyVersion.deleteMany({}));
  await del("policies", () => prisma.policy.deleteMany({}));
  await del("wallets", () => prisma.wallet.deleteMany({}));
  await del("agents", () => prisma.agent.deleteMany({}));
  await del("auditEvents", () => prisma.auditEvent.deleteMany({}));

  const users = await prisma.user.count();
  console.log("demo:reset — wiped demo data:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`  users (kept)            ${users}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });