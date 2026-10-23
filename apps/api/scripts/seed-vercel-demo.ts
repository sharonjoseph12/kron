/**
 * Build-time demo slate for the Vercel function snapshot.
 *
 * The Prisma seed creates the operator and agents, but the approval desk is
 * empty. This leaves two deterministic held actions (hero + bulk delete) and
 * the read receipts behind the hero session so a judge lands on a populated
 * control room. Both databases are copied into the function bundle by
 * `vercel.json` and initialized in `/tmp` by `api/[...path].ts`.
 */
import { saveSandbox } from "@kron/business-tools";
import { prisma } from "../src/db.js";
import { resetDemoState } from "../src/services/demo-reset.js";
import { runScenario } from "../src/services/scenarios.js";

const DEMO_APPROVAL_TTL_MS = 30 * 24 * 3600 * 1000;

async function main(): Promise<void> {
  await resetDemoState();

  // Delete first, hero last: the hero card is the newest approval and is
  // selected by default in the operator desk.
  const deletion = await runScenario("delete", { autoApprove: false, reset: false });
  const hero = await runScenario("hero", { autoApprove: false, reset: false });
  saveSandbox();

  // Build-time approvals must outlive a cold start or a judge opening the
  // link the next day. The data fingerprint still invalidates them if the
  // sandbox moves.
  const pending = await prisma.approval.updateMany({
    where: { status: "pending" },
    data: { expiresAt: new Date(Date.now() + DEMO_APPROVAL_TTL_MS) },
  });
  const receipts = await prisma.enforcementReceipt.count();
  const heroResult = hero.scenarios[0];
  const deleteResult = deletion.scenarios[0];

  console.log(`[demo-seed] pending approvals: ${pending.count}`);
  console.log(`[demo-seed] receipts: ${receipts}`);
  console.log(`[demo-seed] hero: ${heroResult?.action.decision} risk=${heroResult?.action.riskScore}`);
  console.log(`[demo-seed] delete preview rows: ${deleteResult?.action.preview?.rowsAffected ?? 0}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
