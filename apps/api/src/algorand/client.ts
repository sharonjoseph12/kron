/**
 * Thin Algorand REST client built on fetch (no SDK HTTP classes, so it is
 * robust across algosdk versions). Talks to algod for chain params, raw
 * transaction submission and confirmation, and to indexer for read APIs.
 */
import { config } from "../config.js";
import { signPaymentTransaction } from "@kron/x402";
import type { Network } from "@kron/shared";

export interface ChainParams {
  fee: number;
  minFee: number;
  firstValid: number;
  lastValid: number;
  genesisID: string;
  genesisHash: string; // base64
}

export interface Confirmation {
  txId: string;
  confirmedRound: number;
  confirmedAt: string;
}

export interface SentPayment {
  txId: string;
  confirmedRound: number;
  sender: string;
  signedTxnB64: string;
}

export interface AccountInfo {
  address: string;
  balanceAlgo: number;
  pendingRewardsAlgo: number;
  rewardBaseAlgo: number;
  round: number;
}

export interface IndexedTxn {
  id: string;
  round: number;
  sender: string;
  receiver: string;
  amountMicro: number;
  confirmedAt: string;
}

export class AlgorandClient {
  readonly network: Network;
  readonly algodUrl: string;
  readonly algodToken: string;
  readonly indexerUrl: string;
  readonly indexerToken: string;

  constructor(opts?: {
    network?: Network;
    algodUrl?: string;
    algodToken?: string;
    indexerUrl?: string;
    indexerToken?: string;
  }) {
    this.network = opts?.network ?? config.algorandNetwork;
    this.algodUrl = (opts?.algodUrl ?? config.algodUrl).replace(/\/$/, "");
    this.algodToken = opts?.algodToken ?? config.algodToken;
    this.indexerUrl = (opts?.indexerUrl ?? config.indexerUrl).replace(/\/$/, "");
    this.indexerToken = opts?.indexerToken ?? config.indexerToken;
  }

  private algodHeaders(): Record<string, string> {
    return { "X-Algo-API-Token": this.algodToken, Accept: "application/json" };
  }

  private indexerHeaders(): Record<string, string> {
    return { "X-Indexer-API-Token": this.indexerToken, Accept: "application/json" };
  }

  async getChainParams(): Promise<ChainParams> {
    const res = await fetch(`${this.algodUrl}/v2/transactions/params`, {
      headers: this.algodHeaders(),
    });
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

  /** Submit a raw (base64) signed transaction to algod. */
  async submitRawTransaction(signedTxnB64: string): Promise<{ txId: string }> {
    const res = await fetch(`${this.algodUrl}/v2/transactions`, {
      method: "POST",
      headers: { ...this.algodHeaders(), "Content-Type": "application/x-binary" },
      body: Buffer.from(signedTxnB64, "base64"),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`algod submit failed: ${res.status} ${text.slice(0, 400)}`);
    }
    const body = (await res.json()) as { txId?: string };
    return { txId: body.txId ?? "" };
  }

  /** Poll algod until the transaction is confirmed or the timeout elapses. */
  async waitForConfirmation(txId: string, timeoutMs = 20000): Promise<Confirmation> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${this.algodUrl}/v2/transactions/pending/${txId}?format=json`, {
        headers: this.algodHeaders(),
      });
      if (res.ok) {
        const body = (await res.json()) as Record<string, any>;
        if (body["confirmed-round"] != null) {
          return {
            txId,
            confirmedRound: Number(body["confirmed-round"]),
            confirmedAt: new Date().toISOString(),
          };
        }
        if (body["pool-error"]) {
          throw new Error(`transaction rejected by pool: ${body["pool-error"]}`);
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`confirmation timeout for ${txId}`);
  }

  /** Sign, submit and confirm a payment in one step. */
  async sendPayment(args: {
    mnemonic: string;
    amountMicro: bigint;
    recipient: string;
    note?: string;
  }): Promise<SentPayment> {
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
    const { txId } = await this.submitRawTransaction(signed.signedTxnB64);
    const conf = await this.waitForConfirmation(txId);
    return {
      txId: conf.txId,
      confirmedRound: conf.confirmedRound,
      sender: signed.sender,
      signedTxnB64: signed.signedTxnB64,
    };
  }

  async getAccount(address: string): Promise<AccountInfo> {
    const res = await fetch(`${this.algodUrl}/v2/accounts/${encodeURIComponent(address)}`, {
      headers: this.algodHeaders(),
    });
    if (!res.ok) throw new Error(`algod account failed: ${res.status}`);
    const a = (await res.json()) as Record<string, any>;
    return {
      address: String(a.address),
      balanceAlgo: Number(a.amount ?? 0) / 1_000_000,
      pendingRewardsAlgo: Number(a["pending-rewards"] ?? 0) / 1_000_000,
      rewardBaseAlgo: Number(a["reward-base"] ?? 0) / 1_000_000,
      round: Number(a.round ?? 0),
    };
  }

  async getBalanceAlgo(address: string): Promise<number> {
    try {
      return (await this.getAccount(address)).balanceAlgo;
    } catch {
      return 0;
    }
  }

  /** Read an ASA balance (base units) from the account's asset holdings. */
  async getAssetBalance(address: string, assetId: number): Promise<bigint> {
    try {
      const a = await this.getAccount(address);
      const holdings = (a as unknown as { assets?: Array<{ "asset-id": number; amount: number }> }).assets ?? [];
      const holding = holdings.find((h) => h["asset-id"] === assetId);
      return BigInt(holding?.amount ?? 0);
    } catch {
      return 0n;
    }
  }

  /** Recent transactions for an address from the indexer. */
  async getRecentTransactions(address: string, limit = 25): Promise<IndexedTxn[]> {
    const url = `${this.indexerUrl}/v2/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}`;
    const res = await fetch(url, { headers: this.indexerHeaders() });
    if (!res.ok) throw new Error(`indexer txns failed: ${res.status}`);
    const body = (await res.json()) as Record<string, any>;
    const txns: Record<string, any>[] = body.transactions ?? [];
    return txns
      .filter((t) => t["confirmed-round"] != null)
      .map((t) => ({
        id: String(t.id),
        round: Number(t["confirmed-round"]),
        sender: String(t.sender ?? ""),
        receiver: String(t["payment-transaction"]?.receiver ?? ""),
        amountMicro: Number(t["payment-transaction"]?.amount ?? 0),
        confirmedAt: new Date((t["round-time"] ?? Date.now()) * 1000).toISOString(),
      }));
  }

  /** Fetch a single confirmed transaction from algod (canonical on devnet). */
  async getTransaction(txId: string): Promise<Record<string, any> | null> {
    const res = await fetch(
      `${this.algodUrl}/v2/transactions/pending/${encodeURIComponent(txId)}?format=json`,
      { headers: this.algodHeaders() },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, any>;
    if (body["confirmed-round"] == null) return null;
    return body;
  }

  /**
   * Fetch a confirmed transaction from the indexer — the independent,
   * canonical read path for on-chain verification of settled payments.
   */
  async getIndexedTransaction(txId: string): Promise<Record<string, any> | null> {
    const res = await fetch(`${this.indexerUrl}/v2/transactions/${encodeURIComponent(txId)}`, {
      headers: this.indexerHeaders(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { transaction?: Record<string, any> };
    return body.transaction ?? null;
  }

  /** Fetch an application (contract) and its global state from the indexer. */
  async getApp(appId: number): Promise<Record<string, any> | null> {
    const res = await fetch(`${this.indexerUrl}/v2/applications/${appId}`, {
      headers: this.indexerHeaders(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { application?: Record<string, any> };
    return body.application ?? null;
  }
}

export const algorand = new AlgorandClient();
