/**
 * bootstrap-contract — deploys the KRON policy-anchor smart contract to the
 * configured Algorand network and prints the resulting app ID.
 *
 * Run via: pnpm --filter @kron/api bootstrap:contract
 */
import { ensureKronApp } from "../src/algorand/contract.js";
import { config } from "../src/config.js";

async function main() {
  console.log("Deploying KRON policy-anchor contract...");
  const appId = await ensureKronApp();
  if (appId != null) {
    console.log(`KRON contract deployed successfully. App ID: ${appId}`);
    console.log(`Set KRON_APP_ID=${appId} in your environment to reuse this deployment.`);
  } else {
    console.log("Contract deployment returned null. Atomic groups will be disabled.");
    console.log("Check that FUNDING_MNEMONIC is set and algod is reachable.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
