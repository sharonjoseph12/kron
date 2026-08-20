import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { notFound } from "../lib/http.js";
import { requireAuth } from "../lib/auth.js";

function toAlgo(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

export async function walletRoutes(fastify: FastifyInstance) {
  fastify.get("/api/wallets", { preHandler: requireAuth }, async (_request, reply) => {
    const wallets = await prisma.wallet.findMany({ include: { agent: { select: { name: true } } } });
    const rows = await Promise.all(
      wallets.map(async (w) => {
        let balance = 0;
        try {
          balance = await algorand.getBalanceAlgo(w.address);
        } catch {
          /* chain unavailable */
        }
        return {
          id: w.id,
          agentId: w.agentId,
          agentName: w.agent.name,
          address: w.address,
          network: w.network,
          balanceAlgo: balance,
          createdAt: w.createdAt.toISOString(),
        };
      }),
    );
    return { wallets: rows };
  });

  fastify.get("/api/wallets/:agentId", { preHandler: requireAuth }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const wallet = await prisma.wallet.findUnique({ where: { agentId } });
    if (!wallet) return notFound(reply, "Wallet not found");
    let balance = 0;
    try {
      balance = await algorand.getBalanceAlgo(wallet.address);
    } catch {
      /* chain unavailable */
    }
    return {
      wallet: {
        id: wallet.id,
        agentId,
        address: wallet.address,
        network: wallet.network,
        balanceAlgo: balance,
        createdAt: wallet.createdAt.toISOString(),
      },
    };
  });
}

export { toAlgo };