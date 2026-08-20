/**
 * Compile KRON TEAL source files and write base64 bytecode to dist/teal/.
 *
 * Usage:
 *   pnpm --filter @kron/x402 compile:teal
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tealDir = path.join(__dirname, "..", "teal");
const outDir = path.join(__dirname, "..", "dist", "teal");

try {
  mkdirSync(outDir, { recursive: true });
} catch {
  /* already exists */
}

async function compile(source: string): Promise<string> {
  const algodUrl = process.env.ALGOD_URL ?? "http://localhost:4001";
  const algodToken = process.env.ALGOD_TOKEN ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const res = await fetch(`${algodUrl.replace(/\/$/, "")}/v2/teal/compile`, {
    method: "POST",
    headers: {
      "X-Algo-API-Token": algodToken,
      "Content-Type": "text/plain",
    },
    body: source,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TEAL compile failed: ${res.status} ${text.slice(0, 400)}`);
  }
  const body = (await res.json()) as { result?: string };
  if (!body.result) throw new Error("TEAL compile returned no result");
  return body.result;
}

async function main() {
  const approvalSource = readFileSync(path.join(tealDir, "approval.teal"), "utf8");
  const clearSource = readFileSync(path.join(tealDir, "clear.teal"), "utf8");

  console.log("Compiling KRON TEAL programs...");
  const approvalB64 = await compile(approvalSource);
  const clearB64 = await compile(clearSource);

  writeFileSync(path.join(outDir, "approval.b64"), approvalB64);
  writeFileSync(path.join(outDir, "clear.b64"), clearB64);

  console.log(`✓ approval.teal -> dist/teal/approval.b64 (${approvalB64.length} chars)`);
  console.log(`✓ clear.teal    -> dist/teal/clear.b64 (${clearB64.length} chars)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
