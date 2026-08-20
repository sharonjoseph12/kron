# KRON — 24-Hour Offline Hackathon Package

This document is the single source of truth for running KRON without internet.

---

## Prerequisites (install BEFORE going offline)

- Node.js >= 20
- pnpm 10+
- Docker Desktop
- Git (optional, for cloning)

## One-Command Bootstrap (Windows PowerShell)

```powershell
# From the project root:
.\scripts\offline-bootstrap.ps1
```

This script will:
1. Install dependencies (`pnpm install`)
2. Bootstrap the database (`pnpm db:migrate && pnpm db:seed`)
3. Start Algorand localnet via Docker
4. Wait for algod + kmd to be healthy
5. Fund agent wallets from the dev account
6. Start API, Resource Server, and Dashboard

## Manual Step-by-Step

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Database

```bash
pnpm --filter @kron/api prisma:migrate
pnpm --filter @kron/api prisma:seed
```

### 3. Start Algorand LocalNet

```bash
docker compose --profile localnet up -d
```

Wait ~60 seconds for algod to be ready. Verify:

```bash
curl -s http://localhost:4001/v2/status -H "X-Algo-API-Token: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" | Select-Object -First 5
```

### 4. Fund Agent Wallets

```bash
pnpm --filter @kron/api bootstrap:chain
```

### 5. Start the Stack

Open **three** terminal windows:

```bash
# Terminal 1: API + MCP Gateway
pnpm --filter @kron/api dev

# Terminal 2: Resource Server (Paid Tools)
pnpm --filter @kron/resource-server dev

# Terminal 3: Dashboard
pnpm --filter @kron/dashboard dev
```

### 6. Verify

- Dashboard: http://localhost:5173
- API: http://localhost:8787
- Login: `admin@kron.dev` / `admin1234`

## Demo Scripts

```bash
# Multi-agent governance (Researcher vs Trader + boundary block)
pnpm demo:multi

# Agent-to-Agent autonomous subcontracting
pnpm demo:a2a

# Rogue-agent budget cap + human intervention
pnpm demo:budget
```

## Known Offline Gotchas

| Issue | Fix |
|-------|-----|
| `algod unreachable` | Docker not started or not healthy yet. Wait 60s and retry. |
| `ENCRYPTION_KEY must be 32 bytes` | Copy `.env.example` to `.env` and ensure values are set. |
| `FUNDING_MNEMONIC not set` | Ensure `FUNDING_MNEMONIC` is in `apps/api/.env`. |
| Dashboard CORS error | Ensure API is running on 8787 and dashboard on 5173. |

## Reset Everything

```bash
docker compose --profile localnet down -v
Remove-Item -Force apps/api/dev.db
pnpm --filter @kron/api prisma:migrate
pnpm --filter @kron/api prisma:seed
pnpm --filter @kron/api bootstrap:chain
```
