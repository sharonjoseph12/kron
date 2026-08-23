/**
 * Manual bootstrap + settlement diagnostic against the LIVE TestNet contract.
 * Proves: set_runtime -> configure_agent -> enforced atomic settlement.
 */
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import {
  buildSetRuntimeArgs,
  buildConfigureAgentArgs,
  buildAnchorPolicyArgs,
  buildPolicyHash,
  buildAtomicPaymentGroup,
} from "../src/contract.js";

const envText = readFileSync(new URL("../../../apps/api/.env", import.meta.url), "utf8");
const mnemonic = envText.match(/FUNDING_MNEMONIC=(.+)/)![1].trim();
const AGENT_ID = "llm-agent-01";

const algodUrl = "https://testnet-api.algonode.cloud";
const algodToken = "";
const appId = Number(readFileSync(new URL("../../../apps/api/.env", import.meta.url), "utf8").match(/KRON_APP_ID=(\d+)/)![1]);

const creator = algosdk.mnemonicToSecretKey(mnemonic);
const client = new algosdk.Algodv2(algodToken, algodUrl, "");

// Agent wallet mnemonic lives encrypted in DB; derive a THROWAWAY agent instead
const agent = algosdk.generateAccount();

async function wait(txId: string) {
  let info: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    try { info = await client.pendingTransactionInformation(txId).do(); } catch {}
    if (info["confirmed-round"]) return info;
    if (info["pool-error"]) throw new Error("REJECTED: " + info["pool-error"]);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout " + txId);
}

async function appCall(args: Uint8Array[], sender: { addr: algosdk.Address; sk: Uint8Array }, boxes: Uint8Array[]) {
  const p = await client.getTransactionParams().do();
  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: sender.addr,
    appIndex: appId,
    appArgs: args,
    boxes: boxes.map((name) => ({ appIndex: appId, name })),
    suggestedParams: { ...p, fee: 3000, flatFee: true },
  });
  const sent = (await client.sendRawTransaction(algosdk.signTransaction(txn, sender.sk).blob).do()) as Record<string, string>;
  return wait(sent.txId ?? sent.txid);
}

async function main() {
  const status = await client.status().do();
  void status;
  // fund throwaway agent
  const p = await client.getTransactionParams().do();
  const fund = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: creator.addr, receiver: agent.addr, amount: 1_000_000n, suggestedParams: p });
  const fsent = (await client.sendRawTransaction(algosdk.signTransaction(fund, creator.sk).blob).do()) as Record<string, string>;
  await wait(fsent.txId ?? fsent.txid);
  console.log("[diag] agent funded:", agent.addr.toString());

  // 1. set_runtime
  await appCall(
    buildSetRuntimeArgs(agent.addr.toString()),
    creator,
    [Buffer.concat([Buffer.from("as:"), Buffer.from(algosdk.decodeAddress(agent.addr.toString()).publicKey)])],
  );
  console.log("[diag] set_runtime OK");

  // 2. configure_agent: per-call 0.05, daily 0.5 (tight so we can also test rejection)
  await appCall(
    buildConfigureAgentArgs({ agentId: AGENT_ID, perCallLimitMicro: 50_000n, dailyLimitMicro: 500_000n }),
    creator,
    [Buffer.concat([Buffer.from("lim:"), Buffer.from(AGENT_ID)])],
  );
  console.log("[diag] configure_agent OK (per-call 0.05 / daily 0.5)");

  // 3. Compliant settlement 0.018
  const good = buildAtomicPaymentGroup({
    mnemonic: algosdk.mnemonicFromSecretKey?.(agent.sk) ?? algosdk.secretKeyToMnemonic(agent.sk),
    appId,
    amountMicro: 18_000n,
    recipient: creator.addr.toString(),
    policyHash: buildPolicyHash({ policyVersion: 2, decision: "AUTO_APPROVED", reasons: ["diag"], agentId: AGENT_ID, recipient: creator.addr.toString(), amountMicro: "18000", clientRequestId: "diag-" + Date.now() }),
    agentId: AGENT_ID,
    arc2Note: new TextEncoder().encode("kron:j{}"),
    firstValidRound: (await client.getTransactionParams().do()).firstValid,
    lastValidRound: (await client.getTransactionParams().do()).lastValid,
    genesisHash: (await client.getTransactionParams().do()).genesisHash.toString("base64"),
    genesisId: (await client.getTransactionParams().do()).genesisID,
  });
  const goodInfo = await wait(good.paymentTxId);
  console.log("[diag] COMPLIANT PAYMENT CONFIRMED round", goodInfo["confirmed-round"], good.paymentTxId);

  // 4. Out-of-policy 0.08 > 0.05 must REJECT
  let rejected = false;
  try {
    const bad = buildAtomicPaymentGroup({
      mnemonic: algosdk.secretKeyToMnemonic(agent.sk),
      appId,
      amountMicro: 80_000n,
      recipient: creator.addr.toString(),
      policyHash: buildPolicyHash({ policyVersion: 2, decision: "AUTO_APPROVED", reasons: ["diag"], agentId: AGENT_ID, recipient: creator.addr.toString(), amountMicro: "80000", clientRequestId: "diag-bad-" + Date.now() }),
      agentId: AGENT_ID,
      arc2Note: new TextEncoder().encode("kron:j{}"),
      firstValidRound: (await client.getTransactionParams().do()).firstValid,
      lastValidRound: (await client.getTransactionParams().do()).lastValid,
      genesisHash: (await client.getTransactionParams().do()).genesisHash.toString("base64"),
      genesisId: (await client.getTransactionParams().do()).genesisID,
    });
    await wait(bad.paymentTxId);
  } catch {
    rejected = true;
  }
  console.log(rejected ? "[diag] OUT-OF-POLICY REJECTED ON-CHAIN âœ“" : "[diag] !!! ENFORCEMENT BROKEN !!!");
}

main().catch((e) => { console.error("[diag FAIL]", e.message); process.exit(1); });
