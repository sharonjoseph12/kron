/**
 * bootstrap-chain — funds every agent wallet on-chain from the configured
 * FUNDING_MNEMONIC (localnet dev account). Also prints wallet + chain status.
 * Run via: pnpm --filter @kron/api bootstrap:chain
 */
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { algorand } from "../src/algorand/client.js";
import { ensureFunded } from "../src/algorand/vault.js";
import { recordAudit } from "../src/services/audit.js";

async function main() {
  if (!config.fundingMnemonic) {
    console.log("bootstrap-chain: FUNDING_MNEMONIC not set — skipping on-chain funding");
    return;
  }

  let fundingBalance = 0;
  try {
    const params = await algorand.getChainParams();
    console.log(`chain: network=${config.algorandNetwork} round=${params.firstValid} genesis=${params.genesisID}`);
  } catch (err) {
    console.error(`chain: algod unreachable — ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  try {
    const funding = await algosdkAddressFromMnemonic(config.fundingMnemonic);
    fundingBalance = await algorand.getBalanceAlgo(funding);
    console.log(`chain: funding wallet ${funding} balance=${fundingBalance.toFixed(4)} ALGO`);
  } catch {
    /* non-archival funding read may fail */
  }

  const agents = await prisma.agent.findMany({ include: { wallet: true } });
  if (agents.length === 0) {
    console.log("bootstrap-chain: no agents yet — create one in the dashboard first");
    return;
  }

  for (const agent of agents) {
    if (!agent.wallet) {
      console.log(`bootstrap-chain: ${agent.name} has no wallet — skipping`);
      continue;
    }
    const before = await algorand.getBalanceAlgo(agent.wallet.address);
    const after = await ensureFunded(agent.wallet.address);
    console.log(
      `bootstrap-chain: ${agent.name.padEnd(24)} ${agent.wallet.address}  ${before.toFixed(4)} -> ${after.toFixed(4)} ALGO`,
    );
    if (after > before) {
      void recordAudit({
        actorType: "system",
        action: "wallet.funded",
        targetType: "Wallet",
        targetId: agent.wallet.id,
        summary: `Bootstrap funded wallet to ${after.toFixed(4)} ALGO`,
      });
    }
  }

  // Deploy the KRON policy-anchor smart contract
  console.log("");
  const { ensureKronApp } = await import("../src/algorand/contract.js");
  const appId = await ensureKronApp();
  if (appId != null) {
    console.log(`bootstrap-chain: KRON contract deployed (app ID ${appId})`);
  } else {
    console.log("bootstrap-chain: KRON contract deployment skipped or failed.");
  }

  console.log("bootstrap-chain: done");
}

async function algosdkAddressFromMnemonic(mnemonic: string): Promise<string> {
  const algosdk = (await import("algosdk")).default;
  return algosdk.mnemonicToSecretKey(mnemonic).addr.toString();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });