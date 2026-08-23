/**
 * GoPlausible x402 Facilitator integration — reports settled KRON payments
 * to the GoPlausible facilitator so they appear on the public dashboard
 * at https://facilitator.goplausible.xyz/dashboard/transactions
 *
 * This is a fire-and-forget call after on-chain settlement. If the report
 * fails, the payment itself is still valid — we just log the error and
 * move on.
 */
import { config } from "../config.js";

/** CAIP-2 network identifiers used by GoPlausible's x402 facilitator. */
const CAIP2_NETWORK: Record<string, string> = {
  testnet: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
  mainnet: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
};

/** USDC asset IDs on Algorand networks. */
const USDC_ASSET_IDS: Record<string, number> = {
  testnet: 10458941,
  mainnet: 31566704,
};

export interface GoPlausibleReportArgs {
  /** Base64-encoded signed payment transaction(s). */
  signedTxnB64: string;
  /** The payment transaction ID. */
  paymentTxId: string;
  /** App-call transaction ID (for atomic groups), or null. */
  appCallTxId: string | null;
  /** Merchant/recipient address. */
  recipient: string;
  /** Amount in microAlgo or base units. */
  amountMicro: bigint;
  /** The resource URL or identifier. */
  resourceUrl: string;
  /** ASA asset info if paying in USDC/USDT. */
  asset?: { type: "asa"; assetId: number; decimals?: number } | null;
}

/**
 * Report a settled payment to the GoPlausible x402 facilitator.
 *
 * Uses POST /settle which records the transaction in GoPlausible's analytics
 * and makes it visible on their transparency dashboard.
 *
 * This is best-effort / fire-and-forget — failures are logged, never thrown.
 */
export async function reportToGoPlausible(args: GoPlausibleReportArgs): Promise<void> {
  const facilitatorUrl = config.goPlausibleFacilitatorUrl;
  if (!facilitatorUrl) {
    return; // GoPlausible integration disabled
  }

  const network = config.algorandNetwork;
  const caip2Network = CAIP2_NETWORK[network];
  if (!caip2Network) {
    console.warn(`[goplausible] Skipping report — no CAIP-2 mapping for network "${network}"`);
    return;
  }

  try {
    // Build the payment group — array of base64-encoded signed transactions.
    // For atomic groups (app call + payment), we pass both txns.
    // For standalone payments, just the single signed txn.
    const paymentGroup = [args.signedTxnB64];
    const paymentIndex = 0;

    // Determine the asset identifier for paymentRequirements
    const isAsaPayment = args.asset?.type === "asa" && args.asset.assetId > 0;
    const assetId = isAsaPayment ? args.asset!.assetId : 0;
    const assetSymbol = isAsaPayment
      ? assetId === USDC_ASSET_IDS[network]
        ? "USDC"
        : `ASA#${assetId}`
      : "ALGO";

    // x402 v2 paymentPayload for AVM
    const paymentPayload = {
      x402Version: 2,
      scheme: "exact",
      network: caip2Network,
      payload: {
        paymentGroup,
        paymentIndex,
      },
    };

    // x402 v2 paymentRequirements
    const paymentRequirements = {
      scheme: "exact",
      network: caip2Network,
      payTo: args.recipient,
      amount: args.amountMicro.toString(),
      maxAmountRequired: args.amountMicro.toString(),
      ...(isAsaPayment
        ? { asset: String(assetId) }
        : { asset: "10458941" }), // GoPlausible facilitator requires an assetId (USDC default on testnet)
      resource: {
        url: args.resourceUrl,
        method: "GET",
        description: `KRON x402 payment — ${assetSymbol}`,
      },
      description: `KRON autonomous agent payment`,
    };

    const settleUrl = `${facilitatorUrl.replace(/\/+$/, "")}/settle`;
    const res = await fetch(settleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });

    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      console.log(
        `[goplausible] ✓ Reported tx ${args.paymentTxId} to GoPlausible facilitator`,
        body.transaction ? `(facilitator tx: ${String(body.transaction)})` : "",
      );
    } else {
      const text = await res.text().catch(() => "");
      console.warn(
        `[goplausible] ✗ Failed to report tx ${args.paymentTxId} — HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.warn(
      `[goplausible] ✗ Error reporting tx ${args.paymentTxId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
