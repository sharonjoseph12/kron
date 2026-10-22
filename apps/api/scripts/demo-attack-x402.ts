/**
 * Security demo — the resource server's x402 defense surface.
 *  1. no token            -> 402 + WWW-Authenticate: x402 challenge
 *  2. garbage token       -> 402 (decode rejected)
 *  3. wrong-amount token  -> 402 (on-chain amount mismatch)
 *  4. valid payment       -> 200 + premium content
 *  5. replay same token   -> 402 (one-time-use: already redeemed)
 * Run with the resource server on :9100:  pnpm --filter @kron/api exec tsx scripts/demo-attack.ts
 */
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { algorand } from "../src/algorand/client.js";

const BASE = process.env.RESOURCE_URL ?? "http://localhost:9100";
const RESOURCE = "premium-market-report";

async function get(url: string, token?: string): Promise<{ status: number; body: string; header?: string }> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `x402 ${token}` } : undefined,
  });
  return { status: res.status, body: (await res.text()).slice(0, 140), header: res.headers.get("www-authenticate") ?? undefined };
}

function verdict(label: string, expected: number, actual: number): void {
  console.log(`   ${expected === actual ? "PASS" : "FAIL"}  ${label}  [got ${actual}]`);
}

async function main(): Promise<void> {
  if (!config.fundingMnemonic) throw new Error("FUNDING_MNEMONIC not set");
  const merchant = (await fetch(`${BASE}/health`).then((r) => r.json()) as { merchant: string }).merchant;
  console.log("security demo against resource server at", BASE, "(merchant", merchant, ")");

  console.log("\n[1] No token — server must demand payment");
  const r1 = await get(`${BASE}/pay/${RESOURCE}`);
  verdict("HTTP 402 + x402 challenge", 402, r1.status);
  console.log(`   WWW-Authenticate: ${r1.header}`);

  console.log("\n[2] Garbage token — decode must fail");
  const r2 = await get(`${BASE}/pay/${RESOURCE}`, Buffer.from("not-a-transaction").toString("base64"));
  verdict("HTTP 402 rejected", 402, r2.status);

  console.log("\n[3] Real payment, WRONG amount — on-chain check must reject");
  const wrong = await algorand.sendPayment({ mnemonic: config.fundingMnemonic, amountMicro: 5000n, recipient: merchant, note: "kron:attack-wrong-amount" });
  const r3 = await get(`${BASE}/pay/${RESOURCE}`, wrong.signedTxnB64);
  verdict("HTTP 402 (amount mismatch)", 402, r3.status);

  console.log("\n[4] Real payment, correct amount — must deliver");
  const right = await algorand.sendPayment({ mnemonic: config.fundingMnemonic, amountMicro: 18000n, recipient: merchant, note: "kron:attack-valid" });
  const r4 = await get(`${BASE}/pay/${RESOURCE}`, right.signedTxnB64);
  verdict("HTTP 200 delivered", 200, r4.status);
  console.log("   " + r4.body.split("\n")[0]);

  console.log("\n[5] Replay the SAME valid token — one-time-use must reject");
  const r5 = await get(`${BASE}/pay/${RESOURCE}`, right.signedTxnB64);
  verdict("HTTP 402 (replay rejected)", 402, r5.status);

  console.log("\nsecurity demo complete");
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});