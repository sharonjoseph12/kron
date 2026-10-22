# @kron/sdk

**The Official TypeScript SDK for KRON — Policy-Controlled Economic Runtime for AI Agents on Algorand.**

Give autonomous AI agents dedicated Algorand wallets, configurable spending boundaries, and real-time observability without writing custom payment flows.

---

## Installation

```bash
npm install @kron/sdk
# or
pnpm add @kron/sdk
# or
yarn add @kron/sdk
```

---

## Quickstart (5 Minutes)

```typescript
import { KronClient } from "@kron/sdk";

// 1. Initialize client
const kron = new KronClient({
  apiUrl: "http://localhost:8787",
});

// 2. Authenticate
await kron.login("operator@kron.local", process.env.KRON_ADMIN_PASSWORD!);

// 3. Create an agent with its dedicated Algorand wallet
const agent = await kron.createAgent("researcher-01", "Autonomous market research agent");
console.log(`Agent created: ${agent.name} (Wallet: ${agent.walletAddress})`);

// 4. Configure spending policy
await kron.setPolicy(agent.id, {
  perCallLimitAlgo: 0.05,       // Max 0.05 ALGO per single payment
  dailyBudgetAlgo: 5.0,         // Max 5.0 ALGO per calendar day
  sessionBudgetAlgo: 1.0,       // Max 1.0 ALGO per task
  unknownRecipient: "block",    // Block unknown recipient addresses
  firstTimeService: "escalate", // Require human review for new services
});

// 5. Start a session and call a paid MCP tool
const session = await kron.startSession(agent.id, "Analyze semiconductor market");

// When the tool returns 402, KRON intercepts it, checks policy,
// signs and settles on Algorand, and returns the paid content.
const result = await kron.callPaidTool({
  agentId: agent.id,
  sessionId: session.id,
  tool: "market/report",
  arguments: { sector: "semiconductors" },
});

console.log("Paid Result:", result.content);
if (result.isPaid) {
  console.log(`Settled on Algorand: ${result.payment?.txId}`);
  console.log(`Explorer: ${result.payment?.explorerUrl}`);
}
```

---

## Key Capabilities

### 1. Policy Dry-Run (Simulation & Evaluation)

Check if a payment would be permitted before attempting it:

```typescript
const evalResult = await kron.evaluatePayment(agent.id, {
  recipient: "ALGO_RECIPIENT_ADDRESS...",
  amountAlgo: 0.02,
  service: "market",
});

console.log(evalResult.evaluation.decision); // "AUTO_APPROVED" | "ESCALATED" | "BLOCKED"
console.log(evalResult.evaluation.reasons);
```

### 2. Policy What-If Simulation

Run candidate policies against past transactions to estimate spend reductions:

```typescript
const simulation = await kron.simulatePolicy(agent.id, {
  perCallLimitAlgo: 0.02,
  dailyBudgetAlgo: 1.0,
}, 100);

console.log(`Projected spend reduction: ${simulation.reductionPct}%`);
console.log(`Blocked transactions: ${simulation.simulated.blocked}`);
```

### 3. Live SSE Event Stream

Subscribe to real-time events for live dashboards and monitoring:

```typescript
const unsubscribe = kron.subscribeEvents((event) => {
  if (event.type === "payment.created") {
    console.log(`Payment started: ${event.payment.amountAlgo} ALGO for ${event.payment.resourceName}`);
  } else if (event.type === "decision") {
    console.log(`Policy decision: ${event.decision.decision}`);
  }
});

// Later:
// unsubscribe();
```

---

## API Reference

### `KronClient`

| Method | Description |
|---|---|
| `login(email?, password?)` | Authenticate session |
| `logout()` | End session |
| `listAgents()` | List all agents with wallets and policy versions |
| `getAgent(agentId)` | Get agent details |
| `createAgent(name, description?)` | Create agent + wallet |
| `fundWallet(agentId, amountAlgo?)` | Fund agent wallet |
| `getPolicy(agentId)` | Get active spending policy |
| `setPolicy(agentId, policy)` | Update & publish new policy version |
| `getPolicyHistory(agentId)` | Get historical policy versions |
| `activatePolicy(agentId, version)` | Roll back / activate specific policy version |
| `simulatePolicy(agentId, draft, lookback?)` | Run what-if simulation |
| `evaluatePayment(agentId, input)` | Dry-run policy check |
| `startSession(agentId, task?)` | Start task session |
| `listSessions(agentId)` | List sessions |
| `getTimeline(sessionId)` | Get full step-by-step lifecycle |
| `callPaidTool(input)` | Invoke paid MCP tool via KRON runtime |
| `listPayments(params?)` | List payments and status |
| `decideEscalation(escId, approve)` | Approve/block escalated payment |
| `getOverview()` | Real-time aggregate statistics |
| `subscribeEvents(handler)` | Real-time SSE stream |

---

## License

MIT
