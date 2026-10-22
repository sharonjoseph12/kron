/**
 * Session auth for the dashboard (FR-AUTH-001..003). Local/server deployments
 * use a random 256-bit opaque token in an httpOnly cookie backed by a SQLite
 * session row, so logout is immediate and server-side. Serverless deployments
 * can opt into a short-lived HMAC-signed cookie because isolated function
 * instances do not share that SQLite snapshot.
 */
import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";

export const AUTH_COOKIE = "kron.sid";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const STATELESS_PREFIX = "v1.";
const STATELESS_TTL_MS = 12 * 3600 * 1000;
const STATELESS_SESSIONS = process.env.KRON_STATELESS_SESSIONS === "true";

function signStateless(userId: string, sid: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, sid, exp: expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${STATELESS_PREFIX}${payload}.${signature}`;
}

function statelessClaims(token: string): { sub: string; sid: string; exp: number } | null {
  if (!token.startsWith(STATELESS_PREFIX)) return null;
  const [, payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
      sid?: unknown;
      exp?: unknown;
    };
    if (typeof claims.sub !== "string" || typeof claims.sid !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp < Date.now()) return null;
    return { sub: claims.sub, sid: claims.sid, exp: claims.exp };
  } catch {
    return null;
  }
}

async function statelessUser(token: string): Promise<User | null> {
  const claims = statelessClaims(token);
  if (!claims) return null;
  return prisma.user.findUnique({ where: { id: claims.sub } });
}

export async function createSession(userId: string): Promise<{ token: string; cookieToken: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (STATELESS_SESSIONS ? STATELESS_TTL_MS : SESSION_TTL_MS));
  await prisma.session.create({ data: { token, userId, expiresAt } });
  // Vercel functions are isolated and each cold instance has its own SQLite
  // snapshot, so production can opt into a signed cookie that any instance can
  // verify. Local/server deployments keep the DB-backed revocable session.
  return {
    token,
    cookieToken: STATELESS_SESSIONS ? signStateless(userId, token, expiresAt.getTime()) : token,
  };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: (STATELESS_SESSIONS ? STATELESS_TTL_MS : SESSION_TTL_MS) / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(AUTH_COOKIE, { path: "/" });
}

async function resolveSessionToken(token: string): Promise<User | null> {
  if (STATELESS_SESSIONS) {
    const user = await statelessUser(token);
    if (user) return user;
  }
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (session && !session.revoked && session.expiresAt.getTime() >= Date.now()) return session.user;
  return null;
}

export async function getSessionUser(request: FastifyRequest): Promise<User | null> {
  // 1. Check Bearer token in Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const user = await resolveSessionToken(token);
      if (user) return user;
    }
  }

  // 2. Check ?token= query param (EventSource cannot send headers)
  const queryToken = (request.query as Record<string, unknown> | null)?.token;
  if (typeof queryToken === "string" && queryToken) {
    const user = await resolveSessionToken(queryToken);
    if (user) return user;
  }

  // 3. Check session cookie
  const token = request.cookies?.[AUTH_COOKIE];
  if (!token) return null;
  return resolveSessionToken(token);
}

/** Fastify preHandler that 401s when there is no valid session or API key. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSessionUser(request);
  if (!user) {
    return reply.code(401).send({ error: "Unauthorized: Missing or invalid API key / session token" });
  }
  (request as FastifyRequest & { user: User }).user = user;
}

const ROLE_RANK: Record<string, number> = { viewer: 0, operator: 1, admin: 2 };

/**
 * Fastify preHandler factory enforcing the role hierarchy
 * (viewer < operator < admin). Must run after requireAuth.
 */
export function requireRole(minRole: keyof typeof ROLE_RANK | string) {
  const min = ROLE_RANK[minRole] ?? 0;
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user?: User }).user;
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if ((ROLE_RANK[user.role] ?? 0) < min) {
      return reply.code(403).send({ error: `Forbidden: requires role ${minRole} (you are ${user.role})` });
    }
  };
}


export async function revokeSession(token: string): Promise<void> {
  // For signed cookies, revoke the underlying session id when this instance
  // has it. The browser cookie is cleared on logout; signed sessions are
  // intentionally short-lived because serverless instances cannot share the
  // revocation row.
  const sid = statelessClaims(token)?.sid ?? token;
  await prisma.session.updateMany({ where: { token: sid }, data: { revoked: true } });
}

export function currentUser(request: FastifyRequest): User {
  const u = (request as FastifyRequest & { user?: User }).user;
  if (!u) throw new Error("No authenticated user");
  return u;
}