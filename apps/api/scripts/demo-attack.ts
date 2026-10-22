/**
 * `pnpm demo:attack hero|delete|baseline|all`
 *
 * Runs the real Fastify app in-process (no network) against the seeded
 * sandbox SQLite DB. Auto-approves the human decisions so the script proves
 * the end state:
 *   hero     -> safe version approved, attacker inbox stays empty
 *   delete   -> archive approved, 1,204 orders archived, none leaked
 *   baseline -> raw approval leaks exactly one email
 */
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const dbPath = resolve(apiRoot, "prisma/dev.db");

process.env.DATABASE_URL ??= `file:${dbPath.replace(/\\/g, "/")}`;
process.env.NODE_ENV ??= "production";
process.env.SESSION_SECRET ??= randomBytes(32).toString("hex");
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
process.env.KRON_SANDBOX_DB ??= resolve(repoRoot, "data/sandbox.db");
process.env.KRON_RECORDING_MODE ??= "true";
process.env.DEMO_MODE ??= "false";

const credentialFile = resolve(repoRoot, "data/demo-credentials.txt");
const credentialText = existsSync(credentialFile) ? readFileSync(credentialFile, "utf8") : "";
const email = process.env.SEED_ADMIN_EMAIL ?? credentialText.match(/email:\s*(\S+)/)?.[1] ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? credentialText.match(/password:\s*(\S+)/)?.[1] ?? "";
if (!email || !password) {
  console.error("No demo credentials. Run `pnpm demo:reset` first (or set SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD).");
  process.exit(1);
}

type ScenarioName = "hero" | "delete" | "baseline" | "drift" | "all";
const requested = (process.argv[2] ?? "all") as ScenarioName;
if (!["hero", "delete", "baseline", "drift", "all"].includes(requested)) {
  console.error("Usage: pnpm demo:attack hero|delete|baseline|drift|all");
  process.exit(1);
}

const { buildServer } = await import("../src/server.js");
const { prisma } = await import("../src/db.js");
const app = await buildServer();

function fail(message: string): never {
  console.error(`\n✗ FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

try {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  if (login.statusCode !== 200) fail(`login failed (${login.statusCode}); run pnpm demo:reset`);
  const sid = login.cookies?.find((c) => c.name === "kron.sid");
  if (!sid) fail("login returned no session cookie");
  const cookie = `kron.sid=${sid.value}`;

  const response = await app.inject({
    method: "POST",
    url: "/api/demo/scenario",
    headers: { cookie },
    payload: { name: requested, autoApprove: true, reset: true },
  });
  if (response.statusCode !== 200) fail(`scenario failed: ${response.statusCode} ${response.body}`);
  const scenarios = response.json().scenarios as Array<{
    scenario: string;
    steps: Array<{ label: string; decision?: string; detail: string }>;
    action: { decision: string; riskScore: number; preview: { rowsAffected?: number; sensitiveRows?: number; fingerprint?: string } | null };
    approval: { status: string; mode: string; safeActionHash: string | null } | null;
    proof: {
      mail: { attackerMessages: number; outbound: number; messages: Array<{ to: string; subject: string }> };
      orders: { total: number; active: number; archived: number; sensitiveActive: number; pending: number };
    };
    drift?: {
      previewRows: number;
      freshRows: number;
      changedRows: number;
      staleStatus: number;
      staleError: string;
      staleReceiptId: string | null;
      toolInvoked: boolean;
      archivedAfterStale: number;
      pendingAfterStale: number;
      archivedAfterFresh: number;
      freshExecutedRows: number;
      fingerprintBefore: string | null;
      fingerprintAfter: string | null;
    };
  }>;

  const results: Array<{ scenario: string; ok: boolean; headline: string }> = [];
  for (const scenario of scenarios) {
    console.log(`\n=== ${scenario.scenario.toUpperCase()} ===`);
    for (const step of scenario.steps) {
      console.log(`  ${step.decision ? `[${step.decision}] ` : "        "}${step.label}`);
      console.log(`          ${step.detail}`);
    }
    console.log(
      `  proof: attacker=${scenario.proof.mail.attackerMessages} outbound=${scenario.proof.mail.outbound} orders=${scenario.proof.orders.total} active=${scenario.proof.orders.active} archived=${scenario.proof.orders.archived}`,
    );

    if (scenario.scenario === "hero") {
      const ok =
        scenario.action.decision === "HOLD" &&
        scenario.action.riskScore === 75 &&
        scenario.proof.mail.attackerMessages === 0 &&
        scenario.proof.orders.total === 1204 &&
        scenario.proof.orders.sensitiveActive === 37;
      if (!ok) fail("hero did not end clean");
      results.push({ scenario: "hero", ok, headline: "HOLD → safe internal send · attacker 0" });
    } else if (scenario.scenario === "delete") {
      const ok =
        scenario.action.preview?.rowsAffected === 1204 &&
        scenario.action.preview?.sensitiveRows === 37 &&
        scenario.proof.mail.attackerMessages === 0 &&
        scenario.proof.orders.total === 1204 &&
        scenario.proof.orders.active === 0 &&
        scenario.proof.orders.archived === 1204;
      if (!ok) fail("delete did not archive cleanly");
      results.push({ scenario: "delete", ok, headline: "HOLD → archive 1,204 · attacker 0" });
    } else if (scenario.scenario === "baseline") {
      const ok = scenario.action.decision === "HOLD" && !scenario.action.preview && scenario.proof.mail.attackerMessages === 1;
      if (!ok) fail("baseline did not demonstrate the leak");
      results.push({ scenario: "baseline", ok, headline: "raw approval → attacker inbox 1" });
    } else if (scenario.scenario === "drift") {
      const d = scenario.drift;
      const ok =
        Boolean(d) &&
        d!.staleStatus === 409 &&
        d!.toolInvoked === false &&
        Boolean(d!.staleReceiptId) &&
        d!.changedRows === 40 &&
        d!.freshRows === d!.previewRows - 40 &&
        d!.pendingAfterStale === d!.freshRows &&
        d!.archivedAfterStale === 0 &&
        d!.freshExecutedRows === d!.freshRows &&
        d!.archivedAfterFresh === d!.freshRows &&
        d!.fingerprintBefore != null &&
        d!.fingerprintAfter != null &&
        d!.fingerprintBefore !== d!.fingerprintAfter;
      if (!ok) fail("drift scenario did not invalidate the stale card cleanly");
      results.push({
        scenario: "drift",
        ok,
        headline: `stale ${d!.previewRows} → live ${d!.freshRows} · rejected 409 · ${d!.freshExecutedRows} archived`,
      });
    }
  }

  console.log("\n================ RESULT ================");
  for (const row of results) console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.scenario.padEnd(9)} ${row.headline}`);
  console.log("========================================");
  if (process.exitCode) process.exit(process.exitCode);
} finally {
  await app.close();
  await prisma.$disconnect();
}
