/**
 * KRON policy-anchor contract state — live on-chain view for the dashboard.
 * Reads the deployed app's global state from the indexer (the canonical,
 * independent source of truth), so the numbers shown are what is actually
 * stored on the Algorand ledger — not a local cache.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { ensureKronApp } from "../algorand/contract.js";
import { requireAuth } from "../lib/auth.js";

interface GlobalStateEntry {
  key: string; // base64
  value: { type?: number; uint?: number; bytes?: string };
}

function decodeGlobalState(entries: GlobalStateEntry[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries ?? []) {
    let key: string;
    try {
      key = Buffer.from(entry.key, "base64").toString("utf8");
    } catch {
      continue;
    }
    const v = entry.value;
    if (v?.type === 1) out[key] = v.uint ?? 0;
    else if (v?.type === 2 && v.bytes) out[key] = Buffer.from(v.bytes, "base64").toString("hex");
    else out[key] = null;
  }
  return out;
}

export async function contractRoutes(fastify: FastifyInstance) {
  fastify.get("/api/contract", { preHandler: requireAuth }, async (_request, reply) => {
    const appId = await ensureKronApp();
    if (appId == null) {
      return {
        appId: null,
        deployed: false,
        reason: "Contract not deployed — set FUNDING_MNEMONIC (TestNet) or start LocalNet.",
        settlements: 0,
      };
    }

    const app = await algorand.getApp(appId);
    if (!app) {
      return reply.code(404).send({ error: `App ${appId} not found on the ${algorand.network} indexer` });
    }

    const state = decodeGlobalState(app["params"]?.["global-state"] as GlobalStateEntry[] | undefined);
    const settlements = await prisma.settlement.count();

    return {
      appId,
      deployed: true,
      network: algorand.network,
      globalState: {
        totalPayments: Number(state["total_payments"] ?? 0),
        lastPolicyHash: typeof state["last_policy_hash"] === "string" ? state["last_policy_hash"] : null,
        lastAgentId: typeof state["last_agent_id"] === "string" ? state["last_agent_id"] : null,
        lastAmountMicro: Number(state["last_amount_micro"] ?? 0),
        emergencyStop: Number(state["emergency_stop"] ?? 0) === 1,
      },
      settlements,
      createdAtRound: Number(app["created-at-round"] ?? 0),
    };
  });
}