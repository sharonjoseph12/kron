/**
 * `pnpm demo:reset` — deterministic local demo slate.
 *
 * 1. Creates/updates the SQLite schema.
 * 2. Seeds the existing demo agents, wallets and policies.
 * 3. Reseeds the real sandbox business DB (1,204 orders, 37 sensitive rows).
 * 4. Clears approvals/action records/control audit and writes fresh operator
 *    credentials to data/demo-credentials.txt (gitignored; never a default).
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const dbPath = resolve(apiRoot, "prisma/dev.db");

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: `file:${dbPath.replace(/\\/g, "/")}`,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  KRON_SANDBOX_DB: process.env.KRON_SANDBOX_DB ?? resolve(repoRoot, "data/sandbox.db"),
  KRON_RECORDING_MODE: process.env.KRON_RECORDING_MODE ?? "true",
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL ?? "operator@kron.local",
};
const password = process.env.SEED_ADMIN_PASSWORD?.trim() || randomBytes(12).toString("base64url");
env.SEED_ADMIN_PASSWORD = password;
// Prisma and the imported services read process.env, not the child-process
// env object above.
Object.assign(process.env, env);

function run(command: string): void {
  execSync(command, { cwd: apiRoot, env, stdio: "pipe", encoding: "utf8" });
}

console.log("Resetting KRON demo…");
const started = Date.now();
run("npx prisma db push --accept-data-loss --skip-generate");
run("npx tsx prisma/seed.ts");

const { prisma } = await import("../src/db.js");
const { hash } = await import("../src/lib/password.js");
const { resetDemoState } = await import("../src/services/demo-reset.js");

// Seed only creates the admin if absent; force the chosen password so the
// CLI and dashboard always agree after a reset.
const passwordHash = await hash(password);
await prisma.user.upsert({
  where: { email: env.SEED_ADMIN_EMAIL! },
  update: { passwordHash, role: "admin" },
  create: { email: env.SEED_ADMIN_EMAIL!, passwordHash, name: "KRON Operator", role: "admin" },
});

await resetDemoState();
await prisma.$disconnect();

const credentialDir = resolve(repoRoot, "data");
mkdirSync(credentialDir, { recursive: true });
const credentialFile = resolve(credentialDir, "demo-credentials.txt");
writeFileSync(
  credentialFile,
  `KRON demo operator\nemail: ${env.SEED_ADMIN_EMAIL}\npassword: ${password}\n`,
  { mode: 0o600 },
);

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`✓ Demo reset in ${elapsed}s`);
console.log(`  operator: ${env.SEED_ADMIN_EMAIL}`);
console.log(`  password: ${password}`);
console.log(`  written:  ${credentialFile}`);
console.log("  sandbox:  1,204 orders · 37 sensitive rows · attacker inbox empty");
