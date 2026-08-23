/**
 * KRON API entrypoint. Boots Fastify with CORS, cookies, and all route
 * groups, then listens on API_PORT (default 8787).
 */
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { agentRoutes } from "./routes/agents.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { mcpRoutes } from "./routes/mcp.js";
import { paymentRoutes } from "./routes/payments.js";
import { walletRoutes } from "./routes/wallets.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { auditRoutes } from "./routes/audit.js";
import { eventsRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { contractRoutes } from "./routes/contract.js";
import { demoRoutes } from "./routes/demo.js";

const dev = config.nodeEnv !== "production";

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: dev ? "info" : "warn",
      transport: dev ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } : undefined,
    },
    bodyLimit: 2 * 1024 * 1024,
    // The MCP streamable endpoint manages its own JSON-RPC parsing.
    ignoreTrailingSlash: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // allow dashboard inline styles in dev; tighten in prod if needed
    crossOriginEmbedderPolicy: false,
  });
  await fastify.register(cookie);
  await fastify.register(cors, {
    origin: dev ? [config.dashboardUrl, "http://localhost:5173", "http://127.0.0.1:5173"] : config.dashboardUrl,
    credentials: true,
  });

  // Global rate limit (per-IP). Login and the MCP endpoint get stricter
  // per-route limits to blunt brute-force and paywall abuse.
  await fastify.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });

  await fastify.register(authRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(apiKeyRoutes);
  await fastify.register(mcpRoutes);
  await fastify.register(paymentRoutes);
  await fastify.register(walletRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(auditRoutes);
  await fastify.register(eventsRoutes);
  await fastify.register(healthRoutes);
  await fastify.register(contractRoutes);
  await fastify.register(demoRoutes);

  return fastify;
}

const isMain = process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, "/"));

if (isMain || process.env.KRON_API_RUN === "1") {
  const server = await buildServer();
  try {
    await server.listen({ port: config.apiPort, host: "0.0.0.0" });
    // Demo mode: ensure judge-ready agents/wallets/policies after boot
    if (config.demoMode) {
      import("./demo-mode.js").then((m) => m.ensureDemoMode().catch((e) => server.log.warn(e, "demo-mode ensure failed")));
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
  const onShutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", onShutdown);
  process.on("SIGTERM", onShutdown);
}