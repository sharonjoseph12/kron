/**
 * Demo mode — ensures the hackathon demo is ready on every boot when DEMO_MODE=true.
 * Creates researcher-01 (0.05) + trader-01 (0.50), wallets, policies, and the resource MCP server.
 * Idempotent: never duplicates, never overwrites existing funded state.
 */
import { prisma } from "./db.js";
import { config } from "./config.js";
import { createWalletKeys, ensureFunded } from "./algorand/vault.js";
import { createInitialPolicy } from "./services/payment-flow.js";

export async function ensureDemoMode(): Promise<void> {
  if (!config.demoMode) return;
  console.log("[demo-mode] DEMO_MODE=true — ensuring demo agents & wallets…");

  const seeds: Array<{ name: string; description: string; perCall: number; daily: number }> = [
    { name: "researcher-01", description: "Market research agent", perCall: 0.05, daily: 2.0 },
    { name: "trader-01", description: "Trading agent — higher autonomous limit", perCall: 0.5, daily: 10.0 },
  ];

  for (const s of seeds) {
    let agent = await prisma.agent.findFirst({ where: { name: s.name } });
    if (!agent) {
      agent = await prisma.agent.create({ data: { name: s.name, description: s.description, status: "idle" } });
      console.log(`[demo-mode] created agent ${s.name} (${agent.id})`);
    }
    let wallet = await prisma.wallet.findUnique({ where: { agentId: agent.id } });
    if (!wallet) {
      const { address, encryptedKey } = createWalletKeys();
      wallet = await prisma.wallet.create({ data: { agentId: agent.id, address, encryptedKey, network: config.algorandNetwork } });
      console.log(`[demo-mode] created wallet ${address.slice(0, 8)}… for ${s.name}`);
    }
    // Ensure policy exists — createInitialPolicy is idempotent per agent
    try {
      const existing = await prisma.policy.findUnique({ where: { id: agent.id } });
      if (!existing) await createInitialPolicy(agent.id);
    } catch (e) {
      console.warn(`[demo-mode] policy init for ${s.name}:`, e instanceof Error ? e.message : String(e));
    }
    // Best-effort funding (no-op on testnet without FUNDING_MNEMONIC)
    try {
      await ensureFunded(wallet.address, 2);
    } catch {
      /* localnet may not be up yet */
    }
  }

  // Ensure demo resource MCP server entry exists
  const existingMcp = await prisma.mcpServer.findFirst({ where: { name: "demo-resource" } });
  if (!existingMcp) {
    await prisma.mcpServer.create({
      data: { name: "demo-resource", url: config.resourceServerUrl, transport: "streamable-http", status: "offline" },
    });
    console.log("[demo-mode] registered mcp server demo-resource");
  }

  console.log("[demo-mode] ready — researcher-01 (0.05) + trader-01 (0.50) · wallets funded · policies active");
}
