/**
 * End-to-end contract smoke test against a live Algorand node
 * (LocalNet dev-mode in CI, or any algod via env).
 *
 * Proves the full v4 enforcement story on a REAL chain:
 *   1. compile + deploy the KRON policy-anchor contract
 *   2. register an agent wallet as authorized signer (set_runtime)
 *   3. push on-chain spending limits (configure_agent)
 *   4. settle a compliant atomic group [anchor_policy, payment]
 *   5. assert total_payments incremented AND get_payment_count() returns
 *      via ARC-4 log (0x151f prefix)
 *   6. NEGATIVE TEST: an out-of-policy payment (above per-call limit)
 *      MUST be rejected on-chain — the group cannot confirm
 *
 * Usage:
 *   ALGOD_URL=http://localhost:4001 \
 *   ALGOD_TOKEN=aaa... \
 *   FUNDING_MNEMONIC="<25 words>" \
 *   pnpm --filter @kron/x402 exec tsx scripts/e2e-localnet.ts
 */
import algosdk from "algosdk";
import { APPROVAL_TEAL, CLEAR_TEAL, buildPolicyHash, buildAnchorPolicyArgs, buildSetRuntimeArgs, buildConfigureAgentArgs, buildKronAnchorBoxes, arc4EncodeString, arc4MethodSelector, ARC4_METHODS, compileTeal } from "../src/contract.js";

const ALGOD_URL = process.env.ALGOD_URL ?? "http://localhost:4001";
const ALGOD_TOKEN = process.env.ALGOD_TOKEN ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AGENT_ID = "e2e-agent";

function fail(msg: string): never {
  console.error(`\n[E2E FAIL] ${msg}`);
  process.exit(1);
}

async function algodFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${ALGOD_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "X-Algo-API-Token": ALGOD_TOKEN, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`algod ${res.status} ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  return body as Record<string, unknown>;
}

async function submit(blob: Uint8Array): Promise<string> {
  const body = await algodFetch("/v2/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/x-binary" },
    body: Buffer.from(blob),
  });
  return String(body.txId);
}

async function waitConfirmed(txId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const info = await algodFetch(`/v2/transactions/pending/${txId}?format=json`).catch(() => ({}) as Record<string, unknown>);
    if (info["confirmed-round"] != null) return info;
    if (info["pool-error"] != null && String(info["pool-error"]) !== "") {
      throw new Error(`transaction ${txId} rejected: ${info["pool-error"]}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${txId}`);
}

function paramsFrom(status: Record<string, unknown>): object {
  const lastRound = Number(status["last-round"] ?? 1);
  return {
    fee: 1000,
    minFee: 1000,
    flatFee: true,
    firstValid: lastRound,
    lastValid: lastRound + 1000,
    genesisID: String(status["genesis-id"] ?? "dev-v1"),
    genesisHash: Uint8Array.from(Buffer.from(String(status["genesis-hash-b64"] ?? ""), "base64")),
  };
}

async function main(): Promise<void> {
  const mnemonic = process.env.FUNDING_MNEMONIC;
  if (!mnemonic || mnemonic.split(/\s+/).length < 24) {
    fail("FUNDING_MNEMONIC missing or malformed (need a funded account)");
  }
  const creator = algosdk.mnemonicToSecretKey(mnemonic.trim());

  // 0. Node reachable + funded?
  const status = await algodFetch("/v2/status").catch(() => null);
  if (!status) fail(`algod unreachable at ${ALGOD_URL}`);
  const acct = await algodFetch(`/v2/accounts/${creator.addr}`).catch(() => null);
  const balance = Number((acct?.["amount"] as bigint | number) ?? 0);
  console.log(`[e2e] creator ${creator.addr} balance ${balance} microAlgo`);
  if (balance < 10_000_000) fail("creator underfunded (< 10 ALGO) — fund the account first");

  const params = paramsFrom(status);

  // 1. Compile + deploy
  const approvalB64 = await compileTeal(ALGOD_URL, ALGOD_TOKEN, APPROVAL_TEAL);
  const clearB64 = await compileTeal(ALGOD_URL, ALGOD_TOKEN, CLEAR_TEAL);
  console.log("[e2e] TEAL compiled (approval", Buffer.from(approvalB64, "base64").length, "bytes)");

  const appCreate = algosdk.makeApplicationCreateTxnFromObject({
    sender: creator.addr,
    approvalProgram: new Uint8Array(Buffer.from(approvalB64, "base64")),
    clearProgram: new Uint8Array(Buffer.from(clearB64, "base64")),
    numGlobalInts: 3,
    numGlobalByteSlices: 2,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    suggestedParams: params,
  });
  const createTxId = await submit(algosdk.signTransaction(appCreate, creator.sk).blob);
  const created = await waitConfirmed(createTxId);
  const appId = Number(created["application-index"]);
  if (!appId) fail("no application-index returned on create");
  console.log(`[e2e] deployed KRON app ${appId}`);

  // Agent wallet (random throwaway, funded minimally from creator)
  const agent = algosdk.generateAccount();
  const fund = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: creator.addr,
    receiver: agent.addr,
    amount: 5_000_000n,
    suggestedParams: params,
  });
  await waitConfirmed(await submit(algosdk.signTransaction(fund, creator.sk).blob));
  console.log(`[e2e] agent wallet funded: ${agent.addr}`);

  const appCall = (
    args: Uint8Array[],
    sender: typeof agent | typeof creator,
    boxNames?: Uint8Array[],
  ) =>
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: sender.addr,
      appIndex: appId,
      appArgs: args,
      boxes: (boxNames ?? []).map((name) => ({ appIndex: appId, name })),
      suggestedParams: params,
    });

  // 2. Register agent as authorized signer (touches as:<addr> box)
  await waitConfirmed(await submit(algosdk.signTransaction(
    appCall(buildSetRuntimeArgs(agent.addr.toString()), creator, [
      Buffer.concat([Buffer.from("as:"), Buffer.from(algosdk.decodeAddress(agent.addr.toString()).publicKey)]),
    ]),
    creator.sk,
  ).blob));
  console.log("[e2e] agent registered as anchor signer");

  // 3. On-chain limits: per-call 0.1 ALGO, daily 1 ALGO (touches lim:<agent> box)
  await waitConfirmed(await submit(algosdk.signTransaction(
    appCall(
      buildConfigureAgentArgs({ agentId: AGENT_ID, perCallLimitMicro: 100_000n, dailyLimitMicro: 1_000_000n }),
      creator,
      [Buffer.concat([Buffer.from("lim:"), Buffer.from(AGENT_ID)])],
    ),
    creator.sk,
  ).blob));
  console.log("[e2e] on-chain limits configured (per-call 0.1, daily 1.0 ALGO)");

  // 4. Compliant settlement: 50_000 microAlgo grouped [anchor, pay]
  const goodHash = buildPolicyHash({
    policyVersion: 1,
    decision: "AUTO_APPROVED",
    reasons: ["e2e"],
    agentId: AGENT_ID,
    recipient: creator.addr.toString(),
    amountMicro: "50000",
    clientRequestId: `e2e-${Date.now()}`,
  });
  const goodAnchor = appCall(
    buildAnchorPolicyArgs({ policyHash: goodHash, agentId: AGENT_ID, amountMicro: 50_000n }),
    agent,
    buildKronAnchorBoxes(appId, agent.addr.toString(), AGENT_ID).map((b) => b.name),
  );
  const goodPay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: agent.addr,
    receiver: creator.addr,
    amount: 50_000n,
    suggestedParams: params,
  });
  const goodGroup = algosdk.assignGroupID([goodAnchor, goodPay]);
  const goodSigned = Buffer.concat([
    Buffer.from(algosdk.signTransaction(goodGroup[0]!, agent.sk).blob),
    Buffer.from(algosdk.signTransaction(goodGroup[1]!, agent.sk).blob),
  ]);
  await submit(new Uint8Array(goodSigned));
  // Poll the whole group: either member's confirmation proves the group landed
  const goodInfo = await Promise.race([
    (async () => {
      for (;;) {
        for (const t of goodGroup.map((g) => g.txID())) {
          const info = await algodFetch(`/v2/transactions/pending/${t}?format=json`).catch(() => ({}) as Record<string, unknown>);
          if (info["confirmed-round"] != null) return info;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("group confirm timeout")), 30_000)),
  ]);
  console.log(`[e2e] compliant group confirmed in round ${goodInfo["confirmed-round"]}`);

  // 5. total_payments == 1 and ARC-4 getter returns via log
  const appState = await algodFetch(`/v2/applications/${appId}?format=json`);
  const kv = ((appState["params"] as Record<string, unknown>)?.["global-state"] as Array<{ key: string; value: { uint?: number; bytes?: string } }>) ?? [];
  const totalPayments = Number(kv.find((e) => Buffer.from(e.key, "base64").toString() === "total_payments")?.value.uint ?? -1);
  if (totalPayments !== 1) fail(`expected total_payments == 1, got ${totalPayments}`);
  console.log("[e2e] total_payments == 1 ✓");

  const countCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: creator.addr,
    appIndex: appId,
    appArgs: [arc4MethodSelector(ARC4_METHODS.getPaymentCount)],
    suggestedParams: params,
  });
  const countTxId = await submit(algosdk.signTransaction(countCall, creator.sk).blob);
  const countInfo = await waitConfirmed(countTxId);
  const logs = (countInfo.logs as string[] | undefined) ?? [];
  const logBytes = logs[0] ? Buffer.from(logs[0], "base64") : Buffer.alloc(0);
  if (!(logBytes.length === 10 && logBytes[0] === 0x15 && logBytes[1] === 0x1f && logBytes.readBigUInt64BE(2) === 1n)) {
    fail(`get_payment_count ARC-4 log invalid: ${logBytes.toString("hex")}`);
  }
  console.log("[e2e] get_payment_count() -> ARC-4 log 0x151f + uint64(1) ✓");

  // 6. NEGATIVE: out-of-policy amount (200_000 > 100_000 per-call limit)
  const badHash = buildPolicyHash({
    policyVersion: 1,
    decision: "AUTO_APPROVED",
    reasons: ["e2e-negative"],
    agentId: AGENT_ID,
    recipient: creator.addr.toString(),
    amountMicro: "200000",
    clientRequestId: `e2e-neg-${Date.now()}`,
  });
  const badAnchor = appCall(
    buildAnchorPolicyArgs({ policyHash: badHash, agentId: AGENT_ID, amountMicro: 200_000n }),
    agent,
    buildKronAnchorBoxes(appId, agent.addr.toString(), AGENT_ID).map((b) => b.name),
  );
  const badPay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: agent.addr,
    receiver: creator.addr,
    amount: 200_000n,
    suggestedParams: params,
  });
  const badGroup = algosdk.assignGroupID([badAnchor, badPay]);
  const badSigned = Buffer.concat([
    Buffer.from(algosdk.signTransaction(badGroup[0]!, agent.sk).blob),
    Buffer.from(algosdk.signTransaction(badGroup[1]!, agent.sk).blob),
  ]);

  let rejected = false;
  try {
    const badTxId = await submit(new Uint8Array(badSigned));
    await waitConfirmed(badTxId);
  } catch {
    // group rejected (pool-error / timeout while never confirming)
    rejected = true;
  }
  if (!rejected) fail("OUT-OF-POLICY PAYMENT CONFIRMED — on-chain enforcement broken!");
  console.log("[e2e] out-of-policy group REJECTED on-chain ✓ (limits enforced by the chain)");

  console.log("\n[E2E PASS] deploy → authorize → configure → enforce → verify: ALL GREEN");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
