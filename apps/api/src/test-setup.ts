/**
 * Vitest setup — isolates the integration suite onto a fresh SQLite database.
 *
 * Runs once per worker BEFORE any test file imports the app, so config.ts
 * (which reads process.env at import time) sees the test database URL and
 * the fixed secrets below. The schema is pushed with `prisma db push` and
 * seeded with the same script the app uses.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { prisma } from "./db.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbDir = mkdtempSync(path.join(tmpdir(), "kron-test-"));
const dbFile = path.join(dbDir, "test.db");

const TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: `file:${dbFile.replace(/\\/g, "/")}`,
  SESSION_SECRET: "e6b9f2c3a4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
  ENCRYPTION_KEY: "472bb648314453f0ace0a54f14c15d5bebfb251082f780bf7655b5e1a32033c0",
  SEED_ADMIN_EMAIL: "admin@kron.dev",
  SEED_ADMIN_PASSWORD: "admin1234",
  KRON_SANDBOX_DB: path.join(dbDir, "sandbox.db"),
  KRON_RECORDING_MODE: "true",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (value !== undefined) process.env[key] = value;
}

const binDir = path.join(apiRoot, "node_modules", ".bin");
const binExt = process.platform === "win32" ? ".cmd" : "";

function bin(name: string): string {
  return path.join(binDir, `${name}${binExt}`);
}

function run(cmd: string): void {
  try {
    execSync(cmd, { cwd: apiRoot, env: TEST_ENV, stdio: "pipe", encoding: "utf8" });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    throw new Error(`[test-setup] command failed (${cmd})\n${e.stdout ?? ""}\n${e.stderr ?? ""}`);
  }
}

try {
  // Skippable: when a dev server is running it locks the query-engine DLL
  // (Windows EPERM). The existing generated client is then already current.
  run(`"${bin("prisma")}" generate`);
} catch (err) {
  console.warn(`[test-setup] prisma generate skipped: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
}
run(`"${bin("prisma")}" db push --accept-data-loss --skip-generate`);
run(`"${bin("tsx")}" prisma/seed.ts`);

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dbDir, { recursive: true, force: true });
});
