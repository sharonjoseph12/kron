/**
 * DB seed — creates the operator admin account, default multi-agents (Researcher & Trader),
 * their isolated wallets, policies, and demo MCP server registration.
 *
 * Run via: pnpm --filter @kron/api prisma:seed
 */
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { hash } from "../src/lib/password.js";
import { createWalletKeys } from "../src/algorand/vault.js";
import { createPolicyVersion } from "../src/services/policies.js";
import crypto from "node:crypto";

async function main() {
  console.log("🌱 Seeding KRON database...");

  // 1. Admin User — random password unless SEED_ADMIN_PASSWORD is set explicitly.
  const email = config.seedAdminEmail.toLowerCase();
  const explicitPassword = process.env.SEED_ADMIN_PASSWORD?.trim() ?? "";
  const generatedPassword = explicitPassword === "" ? crypto.randomBytes(18).toString("base64url") : null;
  const adminPassword = generatedPassword ?? config.seedAdminPassword;

  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    const passwordHash = await hash(adminPassword);
    admin = await prisma.user.create({
      data: { email, passwordHash, name: "KRON Admin", role: "admin" },
    });
    console.log(`  ✓ Created admin: ${email} (role=admin)`);
    if (generatedPassword) {
      console.log("");
      console.log("  ⚠ SEED_ADMIN_PASSWORD was not set — a random admin password was generated:");
      console.log(`      email:    ${email}`);
      console.log(`      password: ${generatedPassword}`);
      console.log("    (Set SEED_ADMIN_PASSWORD in .env and re-seed to use your own.)");
    } else if (adminPassword === "admin1234" && config.nodeEnv === "production") {
      console.warn("  ⚠ Using the default admin password in production — set SEED_ADMIN_PASSWORD.");
    }
  } else {
    console.log(`  ✓ Admin already exists: ${email}`);
  }

  // 2. Demo Resource Server — tool list is pulled live from the resource
  //    server's /resources endpoint (single source of truth = resources.json),
  //    falling back to the classic demo tools when the server is not up yet.
  const demoTools = await loadDemoTools();
  let resourceServer = await prisma.mcpServer.findFirst({ where: { name: "demo-resource" } });
  if (!resourceServer) {
    resourceServer = await prisma.mcpServer.create({
      data: {
        name: "demo-resource",
        url: config.resourceServerUrl,
        transport: "streamable-http",
        status: "healthy",
        enabled: true,
        tools: { create: demoTools },
      },
    });
    console.log(`  ✓ Created MCP server: demo-resource (${demoTools.length} tools registered)`);
  }

  // 3. Multi-Agent 1: Researcher (Conservative Policy)
  let researcher = await prisma.agent.findFirst({ where: { name: "researcher-01" }, include: { policies: { include: { versions: true } } } });
  if (!researcher) {
    const keys = createWalletKeys();
    researcher = await prisma.agent.create({
      data: {
        name: "researcher-01",
        description: "Conservative research agent: low per-call cap, safe daily budget",
        userId: admin.id,
        status: "idle",
        wallet: {
          create: {
            address: keys.address,
            encryptedKey: keys.encryptedKey,
            network: config.algorandNetwork,
          },
        },
      },
      include: { policies: { include: { versions: true } } },
    });
    console.log(`  ✓ Created agent: researcher-01 (${keys.address})`);
  }
  if (!researcher.policies?.[0]?.versions?.length) {
    await createPolicyVersion(
      researcher.id,
      {
        name: "conservative-research",
        perCallLimitAlgo: 0.02,
        hardCeilingAlgo: 0.1,
        sessionBudgetAlgo: 0.05,
        dailyBudgetAlgo: 0.1,
        maxDailyPayments: 50,
        unknownRecipient: "allow",
        firstTimeService: "allow",
        serviceAllowlist: ["market", "research"],
      },
      admin.id,
    );
    console.log(`  ✓ Provisioned Conservative Policy (0.02 ALGO limit) for researcher-01`);
  }

  // 4. Multi-Agent 2: Trader (Aggressive / Higher Limit Policy)
  let trader = await prisma.agent.findFirst({ where: { name: "trader-01" }, include: { policies: { include: { versions: true } } } });
  if (!trader) {
    const keys = createWalletKeys();
    trader = await prisma.agent.create({
      data: {
        name: "trader-01",
        description: "High-frequency arbitrage & sentiment agent: higher per-call limit and budget",
        userId: admin.id,
        status: "idle",
        wallet: {
          create: {
            address: keys.address,
            encryptedKey: keys.encryptedKey,
            network: config.algorandNetwork,
          },
        },
      },
      include: { policies: { include: { versions: true } } },
    });
    console.log(`  ✓ Created agent: trader-01 (${keys.address})`);
  }
  if (!trader.policies?.[0]?.versions?.length) {
    await createPolicyVersion(
      trader.id,
      {
        name: "high-limit-trader",
        perCallLimitAlgo: 0.05,
        hardCeilingAlgo: 0.2,
        sessionBudgetAlgo: 0.1,
        dailyBudgetAlgo: 0.2,
        maxDailyPayments: 200,
        unknownRecipient: "allow",
        firstTimeService: "allow",
        serviceAllowlist: ["market", "trading", "sentiment"],
      },
      admin.id,
    );
    console.log(`  ✓ Provisioned High-Limit Policy (0.05 ALGO limit) for trader-01`);
  }

  console.log("✨ Seeding completed successfully.");
}

interface DemoResourceDto {
  id: string;
  tool?: string;
  name?: string;
  description?: string;
  amountMicro?: string;
  note?: string;
}

/** Classic demo tools used when the resource server isn't reachable yet. */
const FALLBACK_DEMO_TOOLS: Array<{ name: string; description: string; cost: number }> = [
  { name: "market/report", description: "Premium market research report (costs 0.010 ALGO)", cost: 0.010 },
  { name: "market/sentiment", description: "Real-time institutional sentiment indicators (costs 0.015 ALGO)", cost: 0.015 },
];

/**
 * Pull the paid tool catalog from the resource server's /resources endpoint
 * (backed by resources.json) so costs/names never drift from the real charges.
 */
async function loadDemoTools(): Promise<Array<{ name: string; description: string; cost: number }>> {
  try {
    const res = await fetch(`${config.resourceServerUrl}/resources`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { resources?: DemoResourceDto[] };
    const tools = (body.resources ?? [])
      .filter((r) => typeof r.tool === "string" && r.tool !== "" && Number.isFinite(Number(r.amountMicro)))
      .map((r) => ({
        name: r.tool as string,
        description: `${r.name ?? r.id} — ${r.description ?? ""} (costs ${(Number(r.amountMicro) / 1e6).toFixed(3)} ALGO)`,
        cost: Number(r.amountMicro) / 1e6,
      }));
    if (tools.length === 0) throw new Error("no paid resources");
    return tools;
  } catch (err) {
    console.warn(
      `  ⚠ Could not fetch tools from ${config.resourceServerUrl}/resources (${err instanceof Error ? err.message : String(err)}) — using defaults.`,
    );
    return FALLBACK_DEMO_TOOLS;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("Seed error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });