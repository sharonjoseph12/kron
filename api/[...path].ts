import type { IncomingMessage, ServerResponse } from "node:http";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type KronApp = {
  server: {
    emit(event: string, ...args: unknown[]): boolean;
  };
};

let appPromise: Promise<KronApp> | null = null;

async function getApp(): Promise<KronApp> {
  if (!appPromise) {
    appPromise = (async () => {
      const seedDb = join(process.cwd(), "apps/api/prisma/deploy.db");
      const seedSandbox = join(process.cwd(), "apps/api/prisma/deploy-sandbox.db");
      const runtimeDb = "/tmp/kron.db";
      const runtimeSandbox = "/tmp/kron-sandbox.db";
      if (!existsSync(runtimeDb)) {
        if (!existsSync(seedDb)) {
          throw new Error(`KRON seed database missing at ${seedDb}`);
        }
        copyFileSync(seedDb, runtimeDb);
      }
      if (!existsSync(runtimeSandbox) && existsSync(seedSandbox)) {
        copyFileSync(seedSandbox, runtimeSandbox);
      }

      // The Fastify app is stateful and SQLite-backed. Vercel functions get a
      // writable /tmp, so each cold instance starts from the seeded snapshot.
      process.env.DATABASE_URL = `file:${runtimeDb}`;
      process.env.KRON_SANDBOX_DB = runtimeSandbox;
      process.env.DEMO_MODE ??= "false";
      process.env.NODE_ENV ??= "production";

      const { buildServer } = await import("../apps/api/src/server.js");
      const app = await buildServer();
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

/**
 * Vercel Node function adapter. Fastify is mounted on the function's Node
 * request/response pair so every existing `/api/*` route stays unchanged.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit("request", req, res);
}
