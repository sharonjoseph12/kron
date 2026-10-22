/**
 * `pnpm demo:proof` — runs hero and delete 10 times each against a fresh
 * sandbox and asserts the exact proof-pane end states. No invented numbers.
 */
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
process.env.DATABASE_URL ??= `file:${resolve(apiRoot, "prisma/dev.db").replace(/\\/g, "/")}`;
process.env.NODE_ENV ??= "production";
process.env.SESSION_SECRET ??= randomBytes(32).toString("hex");
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
process.env.KRON_SANDBOX_DB ??= resolve(repoRoot, "data/sandbox.db");
process.env.KRON_RECORDING_MODE ??= "true";

const { runScenario } = await import("../src/services/scenarios.js");
const { prisma } = await import("../src/db.js");

let pass = 0;
const total = 30;

for (let i = 1; i <= 10; i++) {
  const hero = (await runScenario("hero", { autoApprove: true, reset: true })).scenarios[0]!;
  const heroOk =
    hero.action.decision === "HOLD" &&
    hero.action.riskScore === 75 &&
    hero.proof.mail.attackerMessages === 0 &&
    hero.proof.orders.total === 1204 &&
    hero.proof.orders.sensitiveActive === 37;
  console.log(`  ${heroOk ? "PASS" : "FAIL"}  hero   #${i}  attacker=${hero.proof.mail.attackerMessages} total=${hero.proof.orders.total}`);
  if (heroOk) pass++;

  const del = (await runScenario("delete", { autoApprove: true, reset: true })).scenarios[0]!;
  const delOk =
    del.action.preview?.rowsAffected === 1204 &&
    del.action.preview?.sensitiveRows === 37 &&
    del.proof.mail.attackerMessages === 0 &&
    del.proof.orders.total === 1204 &&
    del.proof.orders.active === 0 &&
    del.proof.orders.archived === 1204;
  console.log(`  ${delOk ? "PASS" : "FAIL"}  delete #${i}  attacker=${del.proof.mail.attackerMessages} archived=${del.proof.orders.archived}`);
  if (delOk) pass++;

  const drift = (await runScenario("drift", { reset: true })).scenarios[0]!.drift;
  const driftOk =
    Boolean(drift) &&
    drift!.staleStatus === 409 &&
    drift!.toolInvoked === false &&
    drift!.changedRows === 40 &&
    drift!.archivedAfterStale === 0 &&
    drift!.freshRows === drift!.previewRows - 40 &&
    drift!.freshExecutedRows === drift!.freshRows &&
    drift!.archivedAfterFresh === drift!.freshRows &&
    drift!.fingerprintBefore !== drift!.fingerprintAfter;
  console.log(
    `  ${driftOk ? "PASS" : "FAIL"}  drift  #${i}  stale=${drift?.previewRows} live=${drift?.freshRows} archived=${drift?.archivedAfterFresh}`,
  );
  if (driftOk) pass++;
}

await prisma.$disconnect();
console.log(`\n${pass}/${total} deterministic scenarios passed`);
if (pass !== total) process.exit(1);
