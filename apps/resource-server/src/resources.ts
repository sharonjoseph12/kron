import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PaidResource {
  id: string;
  /** MCP tool name exposed by the resource server (e.g. "market/report"). */
  tool: string;
  name: string;
  description: string;
  amountMicro: string;
  note: string;
  /** Optional stablecoin name — prices this resource in USDC/USDT instead of ALGO. */
  assetName?: "USDC" | "USDT";
}

export type PaidResourceMap = Record<string, PaidResource>;

/** Minimal fallback resources used when no resources.json is found. */
const FALLBACK_RESOURCES: PaidResourceMap = {
  "premium-market-report": {
    id: "premium-market-report",
    tool: "market/report",
    name: "Premium Market Research Report",
    description: "Live market intelligence: sector momentum, liquidity flows and asset-level pricing.",
    amountMicro: "10000",
    note: "kron:premium-market-report",
  },
  "premium-market-sentiment": {
    id: "premium-market-sentiment",
    tool: "market/sentiment",
    name: "Real-Time Institutional Sentiment Indicators",
    description: "Live orderbook imbalance and 24h exchange flow across major venues.",
    amountMicro: "15000",
    note: "kron:premium-market-sentiment",
  },
  "premium-defi-yield": {
    id: "premium-defi-yield",
    tool: "market/defi-yield",
    name: "DeFi Yield & TVL Dashboard",
    description: "Real-time stablecoin yield curves, protocol TVL and liquidity pool APRs across Algorand DeFi.",
    amountMicro: "20000",
    assetName: "USDC",
    note: "kron:premium-defi-yield",
  },
};

/**
 * Load paid resource definitions from JSON so operators can add/price
 * resources without touching code.
 *
 * Resolution order:
 *   1. `KRON_RESOURCES_FILE` env var (absolute or relative path).
 *   2. `resources.json` next to the package (dev `src/..` and built `dist/..`
 *      both resolve to the package root).
 *   3. Bundled {@link FALLBACK_RESOURCES}.
 */
export function loadPaidResources(): PaidResourceMap {
  const envPath = process.env.KRON_RESOURCES_FILE?.trim();
  const candidates = [envPath ?? null, resolve(import.meta.dirname, "../resources.json")].filter(
    (p): p is string => !!p,
  );

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8");
      const data = JSON.parse(raw) as unknown;
      const map = normalize(data);
      if (map) return map;
    } catch {
      // try the next candidate
    }
  }
  return FALLBACK_RESOURCES;
}

function normalize(data: unknown): PaidResourceMap | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const map: PaidResourceMap = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const v = value as Partial<PaidResource> | undefined;
    if (!v || typeof v !== "object") return null;
    if (typeof v.id !== "string" || typeof v.amountMicro !== "string") return null;
    map[key] = {
      id: v.id,
      tool: typeof v.tool === "string" && v.tool !== "" ? v.tool : `kron/${v.id}`,
      name: typeof v.name === "string" ? v.name : v.id,
      description: typeof v.description === "string" ? v.description : "",
      amountMicro: v.amountMicro,
      note: typeof v.note === "string" ? v.note : `kron:${v.id}`,
      assetName: v.assetName === "USDC" || v.assetName === "USDT" ? v.assetName : undefined,
    };
  }
  return map;
}