/**
 * Session auth for the dashboard (FR-AUTH-001..003). A random 256-bit token
 * is stored in an httpOnly cookie; the session row lives in Postgres with an
 * expiry and revoke flag so logouts are immediate and server-side.
 */
import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";

export const AUTH_COOKIE = "kron.sid";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export async function createSession(userId: string): Promise<{ token: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return { token };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(AUTH_COOKIE, { path: "/" });
}

export async function getSessionUser(request: FastifyRequest): Promise<User | null> {
  // 1. Check Bearer token in Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const s = await prisma.session.findUnique({ where: { token }, include: { user: true } });
      if (s && !s.revoked && s.expiresAt.getTime() >= Date.now()) return s.user;
    }
  }

  // 2. Check session cookie
  const token = request.cookies?.[AUTH_COOKIE];
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!s || s.revoked || s.expiresAt.getTime() < Date.now()) return null;
  return s.user;
}

/** Fastify preHandler that 401s when there is no valid session or API key. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSessionUser(request);
  if (!user) {
    return reply.code(401).send({ error: "Unauthorized: Missing or invalid API key / session token" });
  }
  (request as FastifyRequest & { user: User }).user = user;
}


export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({ where: { token }, data: { revoked: true } });
}

export function currentUser(request: FastifyRequest): User {
  const u = (request as FastifyRequest & { user?: User }).user;
  if (!u) throw new Error("No authenticated user");
  return u;
}