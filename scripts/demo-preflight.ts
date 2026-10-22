/**
 * KRON Demo Pre-flight Check
 * 
 * Run before every demo to verify everything works:
 *   npx tsx scripts/demo-preflight.ts
 * 
 * Checks:
 *   1. API server is reachable
 *   2. Authentication works
 *   3. Agents exist and have wallets
 *   4. Wallet balances are sufficient
 *   5. Smart contract is deployed
 *   6. Resource server is reachable
 *   7. MCP servers are healthy
 */

import { readFileSync } from "node:fs";

const API_URL = process.env.KRON_API_URL ?? "http://localhost:8787";
const RES_URL = process.env.RESOURCE_SERVER_URL ?? "http://localhost:9100";
const credentials = (() => {
  try {
    return readFileSync("data/demo-credentials.txt", "utf8");
  } catch {
    return "";
  }
})();
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? credentials.match(/email:\s*(\S+)/)?.[1] ?? "";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? credentials.match(/password:\s*(\S+)/)?.[1] ?? "";
if (!EMAIL || !PASSWORD) {
  console.error("No operator credentials. Run `pnpm demo:reset` first.");
  process.exit(1);
}
const MIN_BALANCE_ALGO = 0.5;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];
let cookie = "";

function pass(name: string, detail: string) {
  results.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}: ${detail}`);
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}: ${detail}`);
}

async function checkApi(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/health`);
    if (res.ok) {
      const body = await res.json() as { status?: string };
      pass("API Server", `${API_URL} — ${body.status ?? "ok"}`);
      return true;
    }
    fail("API Server", `${API_URL} returned ${res.status}`);
    return false;
  } catch (e) {
    fail("API Server", `Cannot reach ${API_URL} — ${(e as Error).message}`);
    return false;
  }
}

async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (res.ok) {
      const sc = res.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0]!;
      pass("Authentication", `Login as ${EMAIL} succeeded`);
      return true;
    }
    fail("Authentication", `Login failed: ${res.status}`);
    return false;
  } catch (e) {
    fail("Authentication", `Login error: ${(e as Error).message}`);
    return false;
  }
}

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: cookie ? { cookie } : {},
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function checkAgents(): Promise<boolean> {
  try {
    const data = await apiGet("/api/agents");
    const agents = data.agents ?? [];
    if (agents.length === 0) {
      fail("Agents", "No agents found — run `pnpm db:seed` first");
      return false;
    }
    const withWallets = agents.filter((a: any) => a.wallet);
    pass("Agents", `${agents.length} agents, ${withWallets.length} with wallets`);

    let allFunded = true;
    for (const agent of agents) {
      if (!agent.wallet) {
        fail(`Agent "${agent.name}" Wallet`, "No wallet provisioned");
        allFunded = false;
        continue;
      }
      const balance = agent.wallet.balance ?? 0;
      if (balance < MIN_BALANCE_ALGO) {
        fail(`Agent "${agent.name}" Balance`, `${balance.toFixed(4)} ALGO (need ≥${MIN_BALANCE_ALGO})`);
        allFunded = false;
      } else {
        pass(`Agent "${agent.name}" Balance`, `${balance.toFixed(4)} ALGO ✓`);
      }
    }
    return allFunded;
  } catch (e) {
    fail("Agents", `Error: ${(e as Error).message}`);
    return false;
  }
}

async function checkContract(): Promise<boolean> {
  try {
    const data = await apiGet("/api/contract");
    if (data.deployed) {
      pass("Smart Contract", `App #${data.appId} deployed on ${data.network} (${data.globalState?.totalPayments ?? 0} payments anchored)`);
      return true;
    }
    fail("Smart Contract", "Not deployed — will auto-deploy on first payment");
    return false;
  } catch (e) {
    fail("Smart Contract", `Error: ${(e as Error).message}`);
    return false;
  }
}

async function checkResourceServer(): Promise<boolean> {
  try {
    const res = await fetch(`${RES_URL}/resources`);
    if (res.ok) {
      const data = await res.json() as any[];
      pass("Resource Server", `${RES_URL} — ${Array.isArray(data) ? data.length : "?"} resources available`);
      return true;
    }
    fail("Resource Server", `${RES_URL} returned ${res.status}`);
    return false;
  } catch (e) {
    fail("Resource Server", `Cannot reach ${RES_URL} — ${(e as Error).message}`);
    return false;
  }
}

async function checkMcp(): Promise<boolean> {
  try {
    const data = await apiGet("/api/mcp/servers");
    const servers = data.servers ?? [];
    const healthy = servers.filter((s: any) => s.status === "healthy");
    if (servers.length === 0) {
      fail("MCP Servers", "No MCP servers registered");
      return false;
    }
    pass("MCP Servers", `${healthy.length}/${servers.length} healthy`);
    return healthy.length > 0;
  } catch (e) {
    fail("MCP Servers", `Error: ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  console.log("\n🔍 KRON Demo Pre-flight Check\n");
  console.log(`   API:      ${API_URL}`);
  console.log(`   Resource: ${RES_URL}`);
  console.log("");

  const apiOk = await checkApi();
  if (!apiOk) {
    console.log("\n⛔ API unreachable — start the stack with `pnpm dev` first.\n");
    process.exit(1);
  }

  const authOk = await checkAuth();
  if (!authOk) {
    console.log("\n⛔ Authentication failed — check credentials or run `pnpm db:seed`.\n");
    process.exit(1);
  }

  await checkAgents();
  await checkContract();
  await checkResourceServer();
  await checkMcp();

  console.log("");
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log("✅ All checks passed — ready for demo!\n");
    process.exit(0);
  } else {
    console.log(`⚠️  ${failed.length} check(s) failed:\n`);
    for (const f of failed) {
      console.log(`   • ${f.name}: ${f.detail}`);
    }
    console.log("");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Pre-flight script crashed:", e);
  process.exit(1);
});
