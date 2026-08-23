import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { StreamableHTTPServerTransport as Transport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { algod } from "./algod.js";
import { bootstrapMerchantWallet } from "./wallet.js";
import { createMcpServer } from "./mcp-server.js";
import { instructionFor, NETWORK, PAID_RESOURCES, paidResourceBody, type PaidResource } from "./instructions.js";
import { parseAuthorizationHeader, X402_AUTH_HEADER } from "@kron/shared";
import { verifyPaymentToken, STABLECOIN_ASSETS } from "@kron/x402";
import { tryConsumePayment } from "./replay.js";
import { verifyGroupedPolicyAnchor } from "./anchor-proof.js";
import { config as cfg } from "./config.js";

const transports = new Map<string, Transport>();

function mcpRoute(merchantAddress: string, req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
  const sessionId = (req.headers["mcp-session-id"] as string) ?? undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    const server = createMcpServer(merchantAddress);
    void server.connect(transport);
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
      void server.close();
    };
    return transport.handleRequest(req, res, body).then(() => {
      if (transport!.sessionId) transports.set(transport!.sessionId, transport!);
    });
  }

  return transport.handleRequest(req, res, body);
}

async function main(): Promise<void> {
  const wallet = await bootstrapMerchantWallet();
  const merchantAddress = wallet.address;
  console.log(`[resource-server] merchant address: ${merchantAddress}`);
  console.log(`[resource-server] merchant balance: ${(await algod.getBalanceAlgo(merchantAddress)).toFixed(4)} ALGO`);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/resources", (_req, res) => {
    res.json({ resources: Object.values(PAID_RESOURCES) });
  });

  app.post("/resources", (req, res) => {
    const { id, name, description, amountMicro, note, tool, assetName } = req.body as Partial<PaidResource>;
    if (!id || !name || !amountMicro) {
      res.status(400).json({ error: "id, name, and amountMicro required" });
      return;
    }
    const newResource: PaidResource = {
      id,
      tool: tool ?? `kron/${id}`,
      name,
      description: description ?? `Dynamic resource ${name}`,
      amountMicro: String(amountMicro),
      note: note ?? `kron:${id}`,
      assetName: assetName === "USDC" || assetName === "USDT" ? assetName : undefined,
    };
    PAID_RESOURCES[id] = newResource;
    res.status(201).json({ resource: newResource });
  });

  app.get("/instructions/:resourceId", (req, res) => {
    const resource = PAID_RESOURCES[req.params.resourceId];
    if (!resource) {
      res.status(404).json({ error: "unknown resource" });
      return;
    }
    res.json(instructionFor(config.baseUrl, merchantAddress, resource));
  });


  // Spec-compliant x402 resource endpoint: no/invalid payment -> HTTP 402 +
  // WWW-Authenticate: x402 challenge; valid signed txn -> the paid content.
  app.get("/pay/:resourceId", async (req, res) => {
    const resource = PAID_RESOURCES[req.params.resourceId];
    if (!resource) {
      res.status(404).json({ error: "unknown resource" });
      return;
    }
    const instruction = instructionFor(config.baseUrl, merchantAddress, resource);
    const challenge = `x402 payment_url="${instruction.paymentUrl}"`;
    const reject = (message: string) => {
      res.setHeader("WWW-Authenticate", challenge);
      res.status(402).json({ error: "payment required", message, challenge });
    };

    const header = req.headers[X402_AUTH_HEADER];
    const token = typeof header === "string" ? parseAuthorizationHeader(header) : null;
    if (!token) {
      reject("send Authorization: x402 <signedTxnB64>");
      return;
    }

    try {
      const verification = await verifyPaymentToken({
        signedTxnB64: token.signedTxnB64,
        algodUrl: config.algodUrl,
        algodToken: config.algodToken,
        expected: {
          recipient: merchantAddress,
          amountMicro: BigInt(resource.amountMicro),
          network: NETWORK,
          assetId: resource.assetName ? STABLECOIN_ASSETS[NETWORK]?.[resource.assetName] : undefined,
        },
      });
      if (!verification.ok) {
        reject(`verification failed: ${verification.reason}`);
        return;
      }
      if (!tryConsumePayment(verification.txId ?? "")) {
        reject("token already redeemed — replay rejected");
        return;
      }
      
      // Hackathon organizer requirement: register the verified payment on the Plausible Facilitator dashboard
      fetch("https://facilitator.goplausible.xyz/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentPayload: { signedTxnB64: token.signedTxnB64 },
          paymentRequirements: {
            accepts: [{ network: NETWORK === "testnet" ? "algorand-testnet" : "algorand-mainnet", payTo: merchantAddress, amount: resource.amountMicro.toString(), asset: resource.assetName }]
          }
        })
      }).catch((e) => console.error("Plausible dashboard ping failed:", e.message));
      // On-chain policy enforcement: reject settlements whose payment is not
      // atomically grouped with a KRON anchor app call (when configured).
      if (cfg.anchorAppId > 0 && cfg.requirePolicyAnchor) {
        try {
          const proof = await verifyGroupedPolicyAnchor({
            paymentTxId: verification.txId ?? "",
            algodUrl: config.algodUrl,
            algodToken: config.algodToken,
            indexerUrl: config.indexerUrl,
            indexerToken: config.indexerToken,
            anchorAppId: cfg.anchorAppId,
          });
          if (!proof.ok) {
            reject(`policy anchor proof rejected: ${proof.reason}`);
            return;
          }
        } catch (proofErr) {
          reject(`anchor proof lookup failed: ${proofErr instanceof Error ? proofErr.message : String(proofErr)}`);
          return;
        }
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(await paidResourceBody(resource, verification.txId));
    } catch (err) {
      reject(err instanceof Error ? err.message : "verification error");
    }
  });

  app.post("/mcp", (req, res) => {
    mcpRoute(merchantAddress, req, res, req.body).catch((err) => {
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  });
  app.get("/mcp", (req, res) => {
    mcpRoute(merchantAddress, req, res).catch((err) => {
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  });
  app.delete("/mcp", (req, res) => {
    mcpRoute(merchantAddress, req, res).catch((err) => {
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, merchant: merchantAddress, tools: Object.keys(PAID_RESOURCES).length });
  });

  app.listen(config.port, () => {
    console.log(`[resource-server] listening on http://localhost:${config.port} (MCP /mcp, instructions /instructions/:id)`);
  });
}

main().catch((err) => {
  console.error(`[resource-server] boot failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});