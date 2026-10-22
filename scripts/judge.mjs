#!/usr/bin/env node
/**
 * KRON Judge Runner — one command for the full demo.
 *
 *   pnpm judge
 *
 * Steps:
 *   1. `pnpm bootstrap` (only when the database is missing)
 *   2. Start the full stack (API + dashboard + resource server) via `pnpm dev`
 *   3. Wait for the API health check
 *   4. Run the multi-agent on-chain demo (`demo-agent --multi`)
 *   5. Print Pera Explorer links for every settled transaction
 *
 * Ctrl+C cleanly stops everything it started.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOG_DIR = join(ROOT, ".judge-logs");
const API_HEALTH = "http://localhost:8787/healthz";
const DASHBOARD = "http://localhost:5173";
const EXPLORER = "https://testnet.explorer.perawallet.app/tx/";

const children = [];
let shuttingDown = false;

function log(tag, msg) {
  process.stdout.write(`[judge:${tag}] ${msg}\n`);
}

function pnpmBin() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function spawnLogged(name, args) {
  mkdirSync(LOG_DIR, { recursive: true });
  const file = join(LOG_DIR, `${name}.log`);
  const stream = createWriteStream(file, { flags: "a" });
  const child = spawn(pnpmBin(), args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tee = (buf) => {
    stream.write(buf);
    if (process.env.JUDGE_VERBOSE) process.stdout.write(`[${name}] ${buf}`);
  };
  child.stdout.on("data", tee);
  child.stderr.on("data", tee);
  children.push({ name, child });
  log(name, `started (pid ${child.pid}, logs: ${file})`);
  return child;
}

async function waitForHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(API_HEALTH);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** Algorand tx ids are 52 chars of RFC-4648 base32 (A-Z2-7). */
function extractTxIds(text) {
  const re = /\b[A-Z2-7]{52}\b/g;
  return [...new Set(text.match(re) ?? [])];
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("main", "shutting down…");
  for (const { name, child } of children.splice(0)) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* already gone */
    }
    log(name, "stopped");
  }
}

process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

if (typeof fetch !== "function") {
  console.error("[judge] Node >= 18 required (global fetch missing)");
  process.exit(1);
}

mkdirSync(LOG_DIR, { recursive: true });
log("main", "KRON judge runner");

// 1. Bootstrap when needed
const dbPath = join(ROOT, "apps", "api", "prisma", "dev.db");
if (!existsSync(dbPath)) {
  log("bootstrap", "database missing — running pnpm bootstrap");
  execSync("pnpm bootstrap", { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
} else {
  log("bootstrap", "database found — skipping bootstrap");
}

// 2. Full stack
spawnLogged("stack", ["dev"]);

// 3. Health gate
log("health", `waiting for ${API_HEALTH} …`);
const healthy = await waitForHealth();
if (!healthy) {
  console.error(`[judge] API did not become healthy within timeout. Check ${LOG_DIR}\\stack.log`);
  cleanup();
  process.exit(1);
}
log("health", "API is healthy");

console.log("\n──────────────────────────────────────────────────────");
console.log(`  Dashboard : ${DASHBOARD}   (credentials: data/demo-credentials.txt)`);
console.log(`  Verify    : ${DASHBOARD}/verify`);
console.log(`  Playground: ${DASHBOARD}/playground`);
console.log("──────────────────────────────────────────────────────\n");

// 4. Multi-agent on-chain demo
log("demo", "running multi-agent demo (real TestNet settlements)…");
const demo = spawnLogged("demo-agent", ["--filter", "@kron/demo-agent", "dev", "--", "--multi"]);

const exitCode = await new Promise((resolveExit) => {
  demo.on("exit", (code) => resolveExit(code ?? 1));
});

// 5. Explorer links for everything the demo settled
const { readFileSync } = await import("node:fs");
try {
  const demoLog = readFileSync(join(LOG_DIR, "demo-agent.log"), "utf8");
  const txIds = extractTxIds(demoLog);
  if (txIds.length > 0) {
    console.log("\nOn-chain settlements — verify them independently:");
    for (const txId of txIds.slice(0, 12)) {
      console.log(`  ${EXPLORER}${txId}`);
    }
  } else {
    log("main", "no transaction ids parsed from the demo log (see .judge-logs/demo-agent.log)");
  }
} catch {
  /* log unreadable — skip links */
}

log("main", `demo exited with code ${exitCode}`);
log("main", `stack is still running — open ${DASHBOARD}, then Ctrl+C to stop everything`);
await new Promise(() => {});
