/**
 * `pnpm demo:history` — add two weeks of sandbox payment history to the local
 * demo database without touching agents, wallets, policies or control-plane
 * approvals. Safe to run repeatedly: only `demo-` rows are replaced.
 */
import "../src/config.js";
import { prisma } from "../src/db.js";
import { seedDemoHistory } from "../src/services/demo-history.js";

async function main(): Promise<void> {
  const summary = await seedDemoHistory();
  console.log("✓ Demo history seeded");
  console.log(`  sessions:            ${summary.sessions}`);
  console.log(`  payments:            ${summary.payments}`);
  console.log(`    auto-approved:     ${summary.autoApproved}`);
  console.log(`    blocked:           ${summary.blocked}`);
  console.log(`    escalated/denied:  ${summary.escalated}`);
  console.log(`  sandbox settlements: ${summary.simulatedSettlements}`);
  console.log(`  timeline events:     ${summary.timelineEvents}`);
  console.log(`  audit events:        ${summary.auditEvents}`);
  console.log("  note: settlements are simulated demo rows (verified=false)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
