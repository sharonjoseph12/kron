# OpenAI (GPT-4 / GPT-4o) Integration with KRON

Integrate OpenAI autonomous agents with KRON to give GPT-4 spending autonomy and dedicated Algorand wallets while maintaining mathematical policy boundaries.

---

## 1. Architecture

```
┌──────────────────────────┐      1. Decide to call tool      ┌──────────────────────────┐
│   GPT-4 / GPT-4o Agent   │ ───────────────────────────────▶ │     @kron/sdk Client     │
└──────────────────────────┘                                  └────────────┬─────────────┘
                                                                           │ 2. Execute with policy
                                                                           ▼
                                                              ┌──────────────────────────┐
                                                              │   KRON Economic Rail     │
                                                              │   - <5ms Policy Engine   │
                                                              │   - Algorand Atomic Tx   │
                                                              │   - x402 Micropayments   │
                                                              └──────────────────────────┘
```

---

## 2. Complete Integration Example

```typescript
import OpenAI from "openai";
import { KronClient } from "@kron/sdk";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const kron = new KronClient({ apiUrl: "http://localhost:8787" });

async function runAutonomousGptAgent() {
  // 1. Authenticate & provision dedicated agent wallet
  await kron.login("operator@kron.local", process.env.KRON_ADMIN_PASSWORD!);
  const agent = await kron.createAgent("gpt4-analyst", "Autonomous financial analysis agent");

  // 2. Set strict economic guardrails
  await kron.setPolicy(agent.id, {
    perCallLimitAlgo: 0.10,
    dailyBudgetAlgo: 1.0,
    unknownRecipient: "allow",
    serviceAllowlist: ["market", "sentiment"],
  });

  // Top up agent testnet wallet
  await kron.fundWallet(agent.id, 2.0);

  // 3. Define tool for OpenAI Function Calling
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "buy_market_intelligence",
        description: "Purchase premium real-time market report or institutional sentiment on Algorand TestNet (costs 0.018 - 0.450 ALGO)",
        parameters: {
          type: "object",
          properties: {
            toolName: {
              type: "string",
              enum: ["market/report", "market/sentiment"],
              description: "The paid data feed to acquire",
            },
            asset: { type: "string", description: "Asset focus (e.g. ALGO, BTC)" }
          },
          required: ["toolName"],
        },
      },
    },
  ];

  // 4. Start GPT interaction session
  const session = await kron.startSession(agent.id, "Analyze Algorand ecosystem trends");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are an autonomous AI research analyst with a dedicated Algorand spending budget managed by KRON." },
      { role: "user", content: "Inspect current crypto market dynamics and acquire institutional sentiment for ALGO." }
    ],
    tools,
  });

  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (toolCall && toolCall.function.name === "buy_market_intelligence") {
    const args = JSON.parse(toolCall.function.arguments);

    console.log(`[GPT-4] Decided to purchase paid tool: ${args.toolName}`);

    // KRON automatically handles x402 402-challenge, policy evaluation, and Algorand signing
    const result = await kron.callPaidTool({
      agentId: agent.id,
      sessionId: session.id,
      tool: args.toolName,
      arguments: { asset: args.asset || "ALGO" },
    });

    console.log("[KRON] Autonomous Settlement TX:", result.payment?.txId);
    console.log("[KRON] Paid Content Delivered:\n", result.content);
  }
}

runAutonomousGptAgent();
```
