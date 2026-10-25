import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { config } from "../config.js";

/**
 * Build the health payload. Registered on four paths so judges can hit any of
 * `/healthz`, `/health`, `/api/healthz` or `/api/health` — including behind the
 * Vercel rewrite, where redirecting to a root path would land on the SPA
 * instead of the function.
 */
async function sendHealth(reply: FastifyReply) {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    /* db down */
  }
  let algodOk = false;
  try {
    await algorand.getChainParams();
    algodOk = true;
  } catch {
    /* chain down */
  }
  let indexerOk = false;
  try {
    // Lightweight indexer check — getApp on 0 returns 404 quickly if reachable
    await fetch(`${config.indexerUrl}/v2/health`, { headers: { "X-Indexer-API-Token": config.indexerToken } }).then((r) => {
      if (r.ok || r.status === 404) indexerOk = true;
    });
    if (!indexerOk) await algorand.getApp(1).then(() => { indexerOk = true; }).catch(() => {});
    // Treat indexer as ok if algod is ok but indexer fetch threw (localnet may not have indexer)
    if (config.algorandNetwork === "localnet" && algodOk) indexerOk = true;
  } catch {
    indexerOk = config.algorandNetwork === "localnet" ? algodOk : false;
  }
  let contractOk: boolean | null = null;
  let contractAppId: number | null = null;
  if (algodOk) {
    try {
      const { ensureKronApp } = await import("../algorand/contract.js");
      contractAppId = await ensureKronApp().catch(() => null);
      if (contractAppId) {
        const app = await algorand.getApp(contractAppId);
        contractOk = !!app;
      } else {
        contractOk = null; // not deployed yet — not a failure in demo mode
      }
    } catch {
      contractOk = false;
    }
  }
  const mcpServers = await prisma.mcpServer.count().catch(() => 0);
  const healthy = dbOk && algodOk;
  return reply.code(healthy ? 200 : 503).send({
    ok: healthy,
    service: "kron-api",
    version: "1.0.0",
    network: config.algorandNetwork,
    database: dbOk ? "ok" : "down",
    algod: algodOk ? "ok" : "down",
    checks: {
      db: dbOk ? "ok" : "down",
      algod: algodOk ? "ok" : "down",
      indexer: indexerOk ? "ok" : "down",
      contract: contractOk == null ? "not-deployed" : contractOk ? "ok" : "down",
      contractAppId,
    },
    mcpServers,
    demoMode: config.demoMode,
  });
}

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/healthz", async (_request, reply) => sendHealth(reply));

  // Aliases. Serve the payload directly instead of redirecting: behind the
  // Vercel rewrite a redirect to `/healthz` resolves to the SPA, not this API.
  fastify.get("/health", async (_request, reply) => sendHealth(reply));
  fastify.get("/api/healthz", async (_request, reply) => sendHealth(reply));
  fastify.get("/api/health", async (_request, reply) => sendHealth(reply));
}
