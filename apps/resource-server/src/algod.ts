import { signPaymentTransaction } from "@kron/x402";
import { config } from "./config.js";

export interface ChainParams {
  fee: number;
  minFee: number;
  firstValid: number;
  lastValid: number;
  genesisID: string;
  genesisHash: string;
}

export class AlgodClient {
  private readonly headers: Record<string, string>;

  constructor(
    private readonly url: string,
    token: string,
  ) {
    this.headers = { "X-Algo-API-Token": token, Accept: "application/json" };
  }

  async getChainParams(): Promise<ChainParams> {
    const res = await fetch(`${this.url}/v2/transactions/params`, { headers: this.headers });
    if (!res.ok) throw new Error(`algod params failed: ${res.status} ${await res.text()}`);
    const p = (await res.json()) as Record<string, any>;
    return {
      fee: Number(p.fee ?? 1000),
      minFee: Number(p["min-fee"] ?? 1000),
      firstValid: Number(p["last-round"]),
      lastValid: Number(p["last-round"]) + 1000,
      genesisID: String(p["genesis-id"] ?? ""),
      genesisHash: String(p["genesis-hash"] ?? ""),
    };
  }

  async submitRawTransaction(signedTxnB64: string): Promise<string> {
    const res = await fetch(`${this.url}/v2/transactions`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/x-binary" },
      body: Buffer.from(signedTxnB64, "base64"),
    });
    if (!res.ok) throw new Error(`algod submit failed: ${res.status} ${(await res.text()).slice(0, 400)}`);
    const body = (await res.json()) as { txId?: string };
    return body.txId ?? "";
  }

  async waitForConfirmation(txId: string, timeoutMs = 30000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${this.url}/v2/transactions/pending/${txId}?format=json`, {
        headers: this.headers,
      });
      if (res.ok) {
        const body = (await res.json()) as Record<string, any>;
        if (body["confirmed-round"] != null) return Number(body["confirmed-round"]);
        if (body["pool-error"]) throw new Error(`transaction rejected by pool: ${body["pool-error"]}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`confirmation timeout for ${txId}`);
  }

  async sendPayment(args: {
    mnemonic: string;
    amountMicro: bigint;
    recipient: string;
    note?: string;
  }): Promise<{ txId: string; confirmedRound: number; sender: string }> {
    const params = await this.getChainParams();
    const signed = signPaymentTransaction({
      mnemonic: args.mnemonic,
      amountMicro: args.amountMicro,
      recipient: args.recipient,
      note: args.note,
      firstValidRound: params.firstValid,
      lastValidRound: params.lastValid,
      genesisHash: params.genesisHash,
      genesisId: params.genesisID,
      feeMicro: Math.max(params.minFee, 1000),
    });
    const txId = await this.submitRawTransaction(signed.signedTxnB64);
    const confirmedRound = await this.waitForConfirmation(txId);
    return { txId, confirmedRound, sender: signed.sender };
  }

  async getBalanceAlgo(address: string): Promise<number> {
    const res = await fetch(`${this.url}/v2/accounts/${encodeURIComponent(address)}`, {
      headers: this.headers,
    });
    if (!res.ok) return 0;
    const a = (await res.json()) as Record<string, any>;
    return Number(a.amount ?? 0) / 1_000_000;
  }
}

export const algod = new AlgodClient(config.algodUrl, config.algodToken);
