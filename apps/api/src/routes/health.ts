import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { config } from "../config.js";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/healthz", async (_request, reply) => {
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
    const mcpServers = await prisma.mcpServer
      .count()
      .catch(() => 0);
    const healthy = dbOk && algodOk;
    return reply.code(healthy ? 200 : 503).send({
      ok: healthy,
      service: "kron-api",
      version: "1.0.0",
      network: config.algorandNetwork,
      postgres: dbOk ? "ok" : "down",
      algod: algodOk ? "ok" : "down",
      mcpServers,
    });
  });
}