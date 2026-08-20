/**
 * Cross-cutting Fastify bits: JSON-safe error replies and DTO mappers
 * shared by the route handlers.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AgentDTO, AgentSessionDTO, WalletDTO } from "@kron/shared";
import type { Agent, AgentSession, Wallet } from "@prisma/client";
import { prisma } from "../db.js";
import { toAlgo } from "./money.js";
import { getActivePolicyVersion } from "../services/policies.js";

export function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message });
}

export function notFound(reply: FastifyReply, message = "Not found"): FastifyReply {
  return reply.code(404).send({ error: message });
}

export function serverError(reply: FastifyReply, err: unknown): FastifyReply {
  requestPluginLogger(err);
  return reply.code(500).send({ error: err instanceof Error ? err.message : "Internal error" });
}

function requestPluginLogger(err: unknown): void {
  if (err instanceof Error && process.env.NODE_ENV !== "test") {
    console.error(`[kron] route error: ${err.message}`);
  }
}

export async function toAgentDTO(a: Agent): Promise<AgentDTO> {
  const policyVersion = await getActivePolicyVersion(a.id).then((v) => v ?? null);
  const wallet = await prisma.wallet.findUnique({ where: { agentId: a.id } });
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    status: a.status as AgentDTO["status"],
    walletId: wallet?.id ?? null,
    walletAddress: wallet?.address ?? null,
    activePolicyId: policyVersion?.policyId ?? null,
    activePolicyVersion: policyVersion?.version ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toSessionDTO(s: AgentSession): AgentSessionDTO {
  return {
    id: s.id,
    agentId: s.agentId,
    task: s.task,
    status: s.status as AgentSessionDTO["status"],
    totalSpendAlgo: 0, // filled by callers that aggregate payments
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
  };
}

export async function toWalletDTO(w: Wallet): Promise<WalletDTO> {
  return {
    id: w.id,
    agentId: w.agentId,
    address: w.address,
    network: w.network as WalletDTO["network"],
    balanceAlgo: 0, // filled by callers that query the chain
    createdAt: w.createdAt.toISOString(),
  };
}

export function requireAgentParam(request: FastifyRequest): string {
  const { id } = request.params as { id: string };
  if (!id) throw new Error("Missing agent id");
  return id;
}

export { toAlgo };

export type { FastifyRequest, FastifyReply };