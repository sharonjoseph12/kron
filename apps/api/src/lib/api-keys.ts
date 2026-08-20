/**
 * API key auth for programmatic agents (SDK, MCP clients, LLM agents).
 * A key is generated once, stored as a SHA-256 hash, and can be bound to a
 * single agent (the key then can only act as that agent).
 */
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";

const KEY_PREFIX = "kron_";

export function generateApiKey(): string {
  return `${KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export interface ApiKeyPrincipal {
  keyId: string;
  userId: string;
  /** When set, the key is bound to this agent and can only act as it. */
  agentId: string | null;
  name: string | null;
}

export function apiKeyFromRequest(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m?.[1]) return m[1].trim();
  }
  const x = request.headers["x-api-key"];
  return typeof x === "string" && x.trim() !== "" ? x.trim() : null;
}

export async function resolveApiKeyPrincipal(rawKey: string): Promise<ApiKeyPrincipal | null> {
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(rawKey) } });
  if (!key || key.revoked) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  return { keyId: key.id, userId: key.userId, agentId: key.agentId, name: key.name };
}

/** Attach the resolved API key principal to the request, if a valid key is presented. */
export async function attachApiKeyPrincipal(request: FastifyRequest): Promise<void> {
  const raw = apiKeyFromRequest(request);
  if (!raw) return;
  const principal = await resolveApiKeyPrincipal(raw);
  if (!principal) return;
  (request as FastifyRequest & { apiKey?: ApiKeyPrincipal }).apiKey = principal;
  void prisma.apiKey.updateMany({ where: { id: principal.keyId }, data: { lastUsedAt: new Date() } });
}

export function currentApiKey(request: FastifyRequest): ApiKeyPrincipal | null {
  return (request as FastifyRequest & { apiKey?: ApiKeyPrincipal }).apiKey ?? null;
}