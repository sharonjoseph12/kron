# Claude & Claude Desktop Integration with KRON

KRON exposes a full Model Context Protocol (MCP) streamable HTTP gateway at `http://localhost:8787/mcp`. This allows Claude Desktop or any MCP client to autonomously discover paid tools, trigger spending policies, and settle micro-transactions directly on the Algorand blockchain.

---

## 1. Quick Setup in Claude Desktop

Add KRON to your Claude Desktop configuration:

### macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
### Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "kron": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:8787/mcp"
      ]
    }
  }
}
```

Restart Claude Desktop. You will see the KRON hammer/tool icon appear with available tools:
- `kron.list_available_tools` — Inspect available resources and their real-time costs
- `kron.get_wallet` — Check dedicated Algorand wallet balance and address
- `kron.evaluate_payment` — Dry-run spending policy against candidate transaction
- `kron.call_tool` — Autonomously invoke paid tools with x402 on-chain settlement

---

## 2. Example Prompt for Claude

Once connected, you can prompt Claude:

> "Check your wallet balance with KRON, inspect available market tools, and fetch the latest live premium market intelligence report for the crypto sector."

### What Happens Behind the Scenes:
1. **Tool Discovery**: Claude calls `kron.list_available_tools`.
2. **Economic Evaluation**: Claude invokes `kron.call_tool("market/report")`.
3. **402 Intercept**: Resource server challenges with `402 Payment Required` (0.018 ALGO).
4. **Policy Check**: KRON evaluates spending constraints in `<5ms`.
5. **On-Chain Settlement**: KRON creates an Algorand Atomic Group with policy hash anchor and submits to TestNet.
6. **Delivery**: Paid real-time market data is returned to Claude with cryptographic proof.

---

## 3. Setting Spending Boundaries for Claude

You can configure Claude's spending rules via the KRON Operator Dashboard (`http://localhost:5173`) or via `@kron/sdk`:

```typescript
import { KronClient } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "http://localhost:8787" });
await kron.login("admin@kron.dev", "admin1234");

await kron.setPolicy("claude-agent-id", {
  perCallLimitAlgo: 0.10,    // Max 0.10 ALGO per tool call
  dailyBudgetAlgo: 2.0,      // Max 2.0 ALGO daily budget
  unknownRecipient: "block", // Block unapproved payees
  serviceAllowlist: ["market", "news"],
});
```
