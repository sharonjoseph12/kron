# KRON Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Autonomous AI Agent                          │
│              (LangChain / LlamaIndex / MCP Client)                  │
└──────────────────────────────┬──────────────────────────────────────┘
                                │ MCP Tool Request
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      KRON MCP Gateway                               │
│  ┌─────────────────────────────┐   ┌─────────────────────────────┐  │
│  │   x402 402 Interceptor      │──▶│   Policy Engine (<5ms)      │  │
│  └─────────────────────────────┘   └─────────────┬───────────────┘  │
│                                                  │                  │
│                                   AUTO_APPROVED / ESCALATED / BLOCKED│
│                                                  │                  │
│  ┌─────────────────────────────┐                ▼                  │
│  │ Isolated Key Vault          │──▶ Sign Atomic Transaction Group   │  │
│  │ (AES-256-GCM)               │    [App Call + Payment Tx]        │  │
│  └─────────────────────────────┘                                    │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │                              │
     Real-Time SSE Events             3.3s Finality
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌──────────────────────────────────┐
│      Operator Console        │ │      Algorand Ledger             │
│  ┌────────────────────────┐  │ │  ┌────────────────────────────┐  │
│  │ Live Payments Feed     │  │ │  │ App Call (Policy Hash)    │  │
│  │ Policy What-If Sim     │  │ │  │ Payment (microAlgos)      │  │
│  │ On-Chain Verifier      │  │ │  │ ARC-2 Note (kron:j{...})  │  │
│  │ Fleet Emergency Stop   │  │ │  │ Atomic Group (both or     │  │
│  │ Audit Log              │  │ │  │ neither)                  │  │
│  └────────────────────────┘  │ │  └────────────────────────────┘  │
└──────────────────────────────┘ └──────────────────────────────────┘
```

## Data Flow: Autonomous Payment

```mermaid
sequenceDiagram
    participant Agent
    participant Gateway as KRON MCP Gateway
    participant Policy as Policy Engine
    participant Vault as Key Vault
    participant Ledger as Algorand Ledger
    participant Resource as Paid Resource

    Agent->>Gateway: call_tool("market/report")
    Gateway->>Resource: HTTP MCP Request
    Resource-->>Gateway: 402 Payment Required (x402)
    Gateway->>Policy: evaluate(request)
    Policy-->>Gateway: AUTO_APPROVED
    Gateway->>Vault: signAtomicGroup(appCall + payment)
    Vault-->>Gateway: signedGroupB64
    Gateway->>Ledger: submit atomic group
    Ledger-->>Gateway: confirmed (3.3s)
    Gateway->>Resource: deliver paid result
    Resource-->>Gateway: premium data
    Gateway-->>Agent: result + payment proof
```

## Policy Engine Rule Pipeline

```mermaid
flowchart LR
    A[Request] --> B{Emergency Stop?}
    B -->|Yes| Z[BLOCKED]
    B -->|No| C{Amount > 0?}
    C -->|No| Z
    C -->|Yes| D{Recipient Blocked?}
    D -->|Yes| Z
    D -->|No| E{Service Blocked?}
    E -->|Yes| Z
    E -->|No| F{Recipient Allowlisted?}
    F -->|No| Z
    F -->|Yes| G{Service Allowlisted?}
    G -->|No| Z
    G -->|Yes| H{Unknown Recipient?}
    H -->|block| Z
    H -->|escalate| Y[ESCALATED]
    H -->|allow| I{First-Time Service?}
    I -->|block| Z
    I -->|escalate| Y
    I -->|allow| J{Per-Call Limit?}
    J -->|exceeds| K{Hard Ceiling?}
    K -->|Yes| Z
    K -->|No| Y
    J -->|within| L{Session Budget?}
    L -->|exceeded| Z
    L -->|within| M{Daily Budget?}
    M -->|exceeded| Z
    M -->|within| N{Daily Payment Count?}
    N -->|exceeded| Z
    N -->|within| O{Velocity Spike?}
    O -->|Yes| Z
    O -->|No| X[AUTO_APPROVED]
```

## Traceability Chain

```mermaid
erDiagram
    Agent ||--o| Wallet : "has dedicated"
    Agent ||--o{ AgentSession : "runs"
    Agent ||--o{ Policy : "governed by"
    Policy ||--o{ PolicyVersion : "versions"
    AgentSession ||--o{ ToolCall : "contains"
    ToolCall ||--o| PaymentRequest : "triggers"
    PaymentRequest ||--o| PaymentDecision : "receives"
    PaymentRequest ||--o| Settlement : "settles"
    PaymentRequest ||--o{ Escalation : "may escalate"
    Agent ||--o{ Alert : "generates"
    AgentSession ||--o{ TimelineEvent : "tracks"
    Agent ||--o{ AuditEvent : "logged in"
```

## Package Layout

| Package | Responsibility |
|---|---|
| `@kron/shared` | Types, DTOs, constants, protocol helpers |
| `@kron/policy-engine` | Deterministic <5ms rule evaluation + simulation |
| `@kron/x402` | ARC-2 notes, TEAL contract, atomic groups, verification |
| `@kron/sdk` | TypeScript SDK for agent developers |
| `@kron/api` | Fastify REST API, MCP gateway, SSE hub |
| `@kron/dashboard` | React + Tailwind operator console |
| `@kron/resource-server` | Paid MCP tools with x402 gating |
| `@kron/demo-agent` | Autonomous agent driving live demos |

## Why Algorand?

| Feature | Benefit for AI Agents |
|---|---|
| **3.3s Finality** | Agents cannot stall waiting for block confirmation |
| **Sub-cent Fees** | High-frequency micro-transactions viable |
| **Atomic Groups** | Policy anchor + payment succeed or fail together |
| **ARC-2 Notes** | Standardized metadata embedded on-chain |
| **Smart Contracts** | On-chain policy anchoring and auditability |
