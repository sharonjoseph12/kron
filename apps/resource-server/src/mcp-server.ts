import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_PAYMENT_TOKEN_ARG } from "@kron/shared";
import { verifyPaymentToken } from "@kron/x402";
import { config } from "./config.js";
import { tryConsumePayment } from "./replay.js";
import { NETWORK, PAID_RESOURCES, paidResourceBody, paymentRequiredContent } from "./instructions.js";
import {
  fetchLiveMarketReport,
  fetchLiveSentiment,
  fetchLiveWeather,
  fetchLiveHeadlines,
} from "./data-providers.js";

/** Free tools (no payment required) — static. */
const FREE_TOOLS = [
  {
    name: "news/headlines",
    description: "Today's top market headlines. Free.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "weather/forecast",
    description: "3-day weather forecast for a city. Free.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name (default: Zurich)" },
      },
    },
  },
] as const;

/**
 * Paid tools are derived from resources.json so prices/descriptions never
 * drift from the actual charges. Each paid resource becomes one tool that
 * requires an x402 paymentToken (injected by KRON after settlement).
 */
const PAID_TOOLS = Object.values(PAID_RESOURCES).map((r) => ({
  name: r.tool,
  description: `${r.name} (PAID - ${(Number(r.amountMicro) / 1e6).toFixed(3)} ALGO). Requires an x402 paymentToken injected after KRON settles the payment.`,
  inputSchema: {
    type: "object",
    properties: {
      paymentToken: { type: "string", description: "x402 signed payment token (injected by KRON)" },
    },
  },
}));

const TOOLS = [...PAID_TOOLS, ...FREE_TOOLS];

/** Map MCP tool name -> paid resource id, built from resources.json. */
const RESOURCE_BY_TOOL: Record<string, string> = Object.fromEntries(
  Object.values(PAID_RESOURCES).map((r) => [r.tool, r.id]),
);

export function createMcpServer(merchantAddress: string): Server {
  const server = new Server(
    { name: "kron-resource-server", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const resourceId = RESOURCE_BY_TOOL[name];
      if (resourceId) {
        return await handlePaidResource(resourceId, merchantAddress, args);
      }
      switch (name) {
        case "news/headlines":
          return { content: [{ type: "text", text: await fetchLiveHeadlines() }] };
        case "weather/forecast":
          return { content: [{ type: "text", text: await fetchLiveWeather(String(args.city ?? "Zurich")) }] };
        default:
          return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  return server;
}

async function handlePaidResource(resourceId: string, merchantAddress: string, args: Record<string, unknown>) {
  const resource = PAID_RESOURCES[resourceId];
  if (!resource) {
    throw new Error(`Resource ${resourceId} not found`);
  }
  const token = typeof args[MCP_PAYMENT_TOKEN_ARG] === "string" ? args[MCP_PAYMENT_TOKEN_ARG] : undefined;

  if (!token) {
    return paymentRequiredContent(config.baseUrl, merchantAddress, resource);
  }

  const verification = await verifyPaymentToken({
    signedTxnB64: token,
    algodUrl: config.algodUrl,
    algodToken: config.algodToken,
    expected: {
      recipient: merchantAddress,
      amountMicro: BigInt(resource.amountMicro),
      network: NETWORK,
    },
  });

  if (!verification.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: `Payment verification failed: ${verification.reason}` }],
    };
  }
  if (!tryConsumePayment(verification.txId ?? "")) {
    return {
      isError: true,
      content: [{ type: "text", text: "Payment token already redeemed — replay rejected" }],
    };
  }

  // Hackathon organizer requirement: register the verified payment on the Plausible Facilitator dashboard
  const caip2Network = NETWORK === "testnet" ? "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=" : "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
  fetch("https://facilitator.goplausible.xyz/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: {
        x402Version: 2,
        scheme: "exact",
        network: caip2Network,
        payload: {
          paymentGroup: [token],
          paymentIndex: 0
        }
      },
      paymentRequirements: {
        accepts: [{ network: caip2Network, payTo: merchantAddress, amount: resource.amountMicro.toString(), asset: resource.assetName }]
      }
    })
  }).catch((e) => console.error("Plausible dashboard ping failed:", e.message));

  let bodyText: string;
  if (resourceId === "premium-market-sentiment") {
    const live = await fetchLiveSentiment(String(args.asset ?? "ALGO"));
    bodyText = `${live}\n\n[Algorand Settlement Proof]: ${verification.txId ?? "verified"}\n[Payment Method]: x402 Micropayment on Algorand TestNet`;
  } else {
    const live = await fetchLiveMarketReport(String(args.sector ?? "crypto"));
    bodyText = `${live}\n\n[Algorand Settlement Proof]: ${verification.txId ?? "verified"}\n[Payment Method]: x402 Micropayment on Algorand TestNet`;
  }

  return {
    content: [{ type: "text", text: bodyText }],
  };
}