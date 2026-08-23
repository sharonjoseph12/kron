/**
 * SSRF guard for user-supplied MCP server URLs (PRD §9.6).
 * Blocks private/link-local/metadata endpoints in production.
 * Allows localhost in development (localnet demos).
 */
import { config } from "../config.js";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP metadata
]);

function isPrivateIPv4(host: string): boolean {
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^0\.0\.0\.0$/.test(host)) return true;
  return false;
}

export function isSafeUrl(raw: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, reason: "Only http/https allowed" };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || isPrivateIPv4(host)) {
    // Allow localhost/127.0.0.1 in non-production for localnet + resource-server demos
    if (config.nodeEnv !== "production") return { ok: true };
    return { ok: false, reason: `Blocked private host: ${host}` };
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    if (config.nodeEnv === "production") return { ok: false, reason: `Blocked internal host: ${host}` };
  }
  return { ok: true };
}
