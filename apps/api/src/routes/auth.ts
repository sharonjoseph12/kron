import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { LoginSchema } from "@kron/shared";
import algosdk from "algosdk";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { recordAudit } from "../services/audit.js";
import {
  clearSessionCookie,
  createSession,
  currentUser,
  requireAuth,
  revokeSession,
  setSessionCookie,
} from "../lib/auth.js";
import { buildSiwaMessage, newChallenge, verifySiwaSignature, walletEmail } from "../lib/siwa.js";

/** Base origin (scheme://host) presented to the wallet in the SIWA message. */
function loginOrigin(): string {
  try {
    return new URL(config.apiPublicUrl).origin;
  } catch {
    return config.apiPublicUrl;
  }
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get("/api/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = currentUser(request);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role, algorandAddress: user.algorandAddress } };
  });

  fastify.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid login payload" });
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return reply.code(401).send({ error: "Invalid credentials" });

    const { compare } = await import("../lib/password.js");
    const ok = await compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

    const { cookieToken } = await createSession(user.id);
    setSessionCookie(reply, cookieToken);
    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "auth.login",
      targetType: "User",
      targetId: user.id,
      summary: `Login: ${user.email}`,
    });
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role, algorandAddress: user.algorandAddress } };
  });

  fastify.post("/api/auth/api-keys", { preHandler: requireAuth }, async (request, reply) => {
    const user = currentUser(request);
    const { token } = await createSession(user.id);
    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "auth.api_key_created",
      targetType: "User",
      targetId: user.id,
      summary: `Created API key for ${user.email}`,
    });
    return {
      apiKey: token,
      message: "Pass this token in Authorization: Bearer <apiKey> for Claude/GPT agents.",
    };
  });

  fastify.post("/api/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies?.["kron.sid"];
    if (token) await revokeSession(token);
    const user = currentUser(request);
    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "auth.logout",
      targetType: "User",
      targetId: user.id,
      summary: `Logout: ${user.email}`,
    });
    clearSessionCookie(reply);
    return { ok: true };
  });

  /* ------------------------------------------------------------------ */
  /* Pera Wallet / Sign-in-with-Algorand (QR code login)                 */
  /* ------------------------------------------------------------------ */

  fastify.post(
    "/api/auth/pera/challenge",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      // Prune stale challenges opportunistically so the table stays tiny.
      await prisma.loginChallenge.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { consumed: true, createdAt: { lt: new Date(Date.now() - 3600_000) } }],
        },
      });
      const challenge = newChallenge();
      await prisma.loginChallenge.create({
        data: { nonce: challenge.nonce, expiresAt: new Date(challenge.expiresAt) },
      });
      return { nonce: challenge.nonce, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt, origin: loginOrigin() };
    },
  );

  fastify.post(
    "/api/auth/pera/verify",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body as { address?: string; signature?: string; nonce?: string } | null;
      const { address, signature, nonce } = body ?? {};
      if (typeof address !== "string" || typeof signature !== "string" || typeof nonce !== "string") {
        return reply.code(400).send({ error: "address, signature and nonce are required" });
      }
      if (!algosdk.isValidAddress(address)) {
        return reply.code(400).send({ error: "Invalid Algorand address" });
      }

      const challenge = await prisma.loginChallenge.findUnique({ where: { nonce } });
      if (!challenge || challenge.consumed || challenge.expiresAt.getTime() < Date.now()) {
        return reply.code(401).send({ error: "Challenge expired or already used" });
      }

      const message = buildSiwaMessage(loginOrigin(), address, challenge);
      if (!verifySiwaSignature(message, address, signature)) {
        return reply.code(401).send({ error: "Signature verification failed" });
      }

      await prisma.loginChallenge.update({ where: { id: challenge.id }, data: { consumed: true } });

      const user = await prisma.user.upsert({
        where: { algorandAddress: address },
        update: { name: `Pera ${address.slice(0, 6)}` },
        create: {
          email: walletEmail(address),
          name: `Pera ${address.slice(0, 6)}`,
          role: "operator",
          algorandAddress: address,
          passwordHash: crypto.randomBytes(32).toString("hex"),
        },
      });

      const { cookieToken } = await createSession(user.id);
      setSessionCookie(reply, cookieToken);
      void recordAudit({
        actorId: user.id,
        actorType: "user",
        action: "auth.login",
        targetType: "User",
        targetId: user.id,
        summary: `Login (Pera Wallet): ${address.slice(0, 6)}…`,
      });
      return {
        user: { id: user.id, email: user.email, name: user.name, role: user.role, algorandAddress: user.algorandAddress },
      };
    },
  );
}