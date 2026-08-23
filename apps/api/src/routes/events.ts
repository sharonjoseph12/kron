import type { FastifyInstance } from "fastify";
import type { StreamEvent } from "@kron/shared";
import { SSE_KEEPALIVE_MS } from "@kron/shared";
import { hub, toSSE } from "../events/hub.js";
import { requireAuth } from "../lib/auth.js";

export async function eventsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events", { preHandler: requireAuth }, async (_request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(toSSE({ type: "hello", ts: new Date().toISOString() }));

    const send = (event: StreamEvent): void => {
      try {
        res.write(toSSE(event));
      } catch {
        /* socket gone */
      }
    };

    const unsub = hub.subscribe(send);
    const keepalive = setInterval(() => {
      res.write(`: ping\n\n`);
    }, SSE_KEEPALIVE_MS);

    const cleanup = (): void => {
      clearInterval(keepalive);
      unsub();
      try {
        res.end();
      } catch {
        /* already closed */
      }
    };
    res.on("close", cleanup);
  });
}