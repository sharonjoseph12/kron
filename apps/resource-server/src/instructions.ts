import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Network } from "@kron/shared";
import { X402Instruction, X402_PAYMENT_REQUIRED } from "@kron/shared";
import { STABLECOIN_ASSETS } from "@kron/x402";
import { config } from "./config.js";
import { loadPaidResources, type PaidResource } from "./resources.js";
import { fetchLiveMarketReport, fetchLiveSentiment } from "./data-providers.js";

export type { PaidResource } from "./resources.js";

export const NETWORK: Network = config.network;

/** Paid resource catalog, loaded from JSON (overridable via KRON_RESOURCES_FILE). */
export const PAID_RESOURCES = loadPaidResources();

export function registerResource(resource: PaidResource): void {
  PAID_RESOURCES[resource.id] = resource;
}

/** Asset the instruction is denominated in — ALGO by default, or a stablecoin. */
export function assetFor(resource: PaidResource): X402Instruction["asset"] {
  if (resource.assetName) {
    const assetId = STABLECOIN_ASSETS[NETWORK]?.[resource.assetName];
    if (!assetId) {
      throw new Error(`No ${resource.assetName} asset configured for network ${NETWORK}`);
    }
    return { type: "asa", assetId, decimals: 6 };
  }
  return { type: "algo", decimals: 6 };
}

export function instructionFor(
  baseUrl: string,
  recipient: string,
  resource: PaidResource,
): X402Instruction {
  return X402Instruction.parse({
    schemaVersion: "1.0",
    paymentUrl: `${baseUrl}/instructions/${resource.id}`,
    amount: resource.amountMicro,
    asset: assetFor(resource),
    network: NETWORK,
    recipient,
    note: resource.note,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    resource: { id: resource.id, name: resource.name, description: resource.description },
  });
}

export function paymentRequiredContent(
  baseUrl: string,
  recipient: string,
  resource: PaidResource,
): CallToolResult {
  const instruction = instructionFor(baseUrl, recipient, resource);
  return {
    content: [
      {
        type: "text",
        text: "402 Payment Required — premium resource. KRON will present an x402 paymentToken on the paid retry.",
      },
    ],
    structuredContent: {
      type: X402_PAYMENT_REQUIRED,
      challenge: { scheme: "x402", paymentUrl: instruction.paymentUrl },
      instruction,
    },
  };
}

/** The premium content served once payment is verified (live data). */
export async function paidResourceBody(resource: PaidResource, txId?: string): Promise<string> {
  const method = resource.assetName ? `x402 Micropayment on Algorand ${NETWORK} (${resource.assetName})` : `x402 Micropayment on Algorand ${NETWORK}`;
  if (resource.id === "premium-market-sentiment") {
    const live = await fetchLiveSentiment("ALGO");
    return `${live}\n\n[Algorand Settlement Proof]: ${txId ?? "verified"}\n[Payment Method]: ${method}`;
  }
  if (resource.id === "premium-defi-yield") {
    const live = await fetchLiveMarketReport("defi");
    return `${live}\n\n[Algorand Settlement Proof]: ${txId ?? "verified"}\n[Payment Method]: ${method}`;
  }
  const live = await fetchLiveMarketReport("crypto");
  return `${live}\n\n[Algorand Settlement Proof]: ${txId ?? "verified"}\n[Payment Method]: ${method}`;
}
