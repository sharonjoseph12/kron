# KRON — Production Deployment Guide

Deploy KRON to a free host so a judge can click a link instead of running Docker. Both options below run the exact same two services defined in [`docker-compose.prod.yml`](../docker-compose.prod.yml):

| Service | Dockerfile | Port | Purpose |
|---|---|---|---|
| **API** | [`apps/api/Dockerfile`](../apps/api/Dockerfile) | 8787 | Fastify REST API, MCP Gateway, SSE events, dashboard backend |
| **Resource Server** | [`apps/resource-server/Dockerfile`](../apps/resource-server/Dockerfile) | 9100 | Paid MCP tools gated by x402 on Algorand TestNet |

Both Dockerfiles install the pnpm workspace with `--frozen-lockfile`, build the `@kron/shared` / `@kron/x402` / `@kron/policy-engine` deps, and compile their own app. On boot the API runs `prisma db push` + idempotent seed.

---

## Option A — Single VPS / Railway / Render (Docker Compose)

Any host with Docker can run the exact production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

1. **Provision a host** — cheapest free options:
   - **Render** free web services (2 × 512 MB), or
   - **Railway** free trial, or
   - A $4–6 VPS (Hetzner / DigitalOcean / Oracle Cloud Always Free).
2. **Clone the repo** and copy your secrets into a root `.env` (same directory as `docker-compose.prod.yml`). The compose file interpolates `${VAR}` from it.
3. **Open the firewall** for ports `8787` (API) and `9100` (resource server).
4. **Verify** the health endpoint:
   ```bash
   curl https://<your-host>:8787/healthz
   ```

> **Railway / Render note:** `DATABASE_URL=file:/data/kron.db` uses a named volume (`kron-prod-db`). On platforms without persistent volumes the SQLite file lives in the container and is lost on redeploy. For a persistent demo DB, point `DATABASE_URL` at a free managed Postgres (Neon / Supabase) instead.

---

## Option B — Render One-Click (Blueprints)

A [`render.yaml`](../render.yaml) is included at the repo root. It defines the two web services above for Render's free tier (both build from the existing Dockerfiles).

1. Push the repo to GitHub.
2. In Render: **New → Blueprint**, select the repo. Render reads `render.yaml` and creates both services.
3. Fill in the `sync: false` (secret) env vars in the dashboard:
   - `API_PUBLIC_URL` → `https://kron-api.onrender.com`
   - `RESOURCE_SERVER_URL` → `https://kron-resource-server.onrender.com`
   - `DASHBOARD_URL` → your dashboard origin (for CORS, see below)
   - `SESSION_SECRET`, `ENCRYPTION_KEY`, `FUNDING_MNEMONIC`, `SEED_ADMIN_PASSWORD` (API)
   - `KRON_BASE_URL` → `https://kron-resource-server.onrender.com`, `MERCHANT_MNEMONIC` (resource server)
4. Both services auto-deploy on push; Render routes HTTP to the EXPOSE'd port (8787 / 9100).

---

## Environment Variables

### API (`apps/api/Dockerfile`, port 8787)

| Variable | Required | Description | Default |
|---|---|---|---|
| `API_PORT` | no | HTTP port | `8787` |
| `DATABASE_URL` | **yes** | SQLite file or Postgres DSN | — |
| `API_PUBLIC_URL` | yes (prod) | Public base URL of the API | `http://localhost:8787` |
| `RESOURCE_SERVER_URL` | yes (prod) | Public URL of the resource server | `http://localhost:9100` |
| `DASHBOARD_URL` | yes (prod) | Dashboard origin for CORS | `http://localhost:5173` |
| `ALGORAND_NETWORK` | no | `testnet` / `mainnet` / `localnet` | `testnet` |
| `ALGOD_URL` | no | AlgoNode endpoint | `https://testnet-api.algonode.cloud` |
| `INDEXER_URL` | no | AlgoNode indexer | `https://testnet-idx.algonode.cloud` |
| `SESSION_SECRET` | recommend | Session signing secret (≥ 32 chars) | auto-generated* |
| `ENCRYPTION_KEY` | recommend | 64-hex AES-256 key for wallet mnemonics | auto-generated* |
| `FUNDING_MNEMONIC` | no | TestNet account that tops up agent wallets | — |
| `SEED_ADMIN_EMAIL` | no | Seed admin login | `admin@kron.dev` |
| `SEED_ADMIN_PASSWORD` | recommend | Seed admin password | random printed to logs |
| `FORCE_ESCALATE` | no | Escalate every payment (governance demo) | `false` |

\* Auto-generated at boot when missing/too short — set them explicitly so sessions survive restarts.

### Resource Server (`apps/resource-server/Dockerfile`, port 9100)

| Variable | Required | Description | Default |
|---|---|---|---|
| `PORT` | no | HTTP port | `9100` |
| `KRON_BASE_URL` | yes (prod) | Public base URL used in x402 instruction links | `http://localhost:9100` |
| `MERCHANT_MNEMONIC` | **yes** | Funded TestNet account receiving payments | — |
| `ALGORAND_NETWORK` | no | `testnet` / `mainnet` | `testnet` |
| `ALGOD_URL` / `INDEXER_URL` | no | AlgoNode endpoints | testnet defaults |

---

## Funding a TestNet Account

1. Go to the **Algorand TestNet Dispenser**: <https://testnet.algorand.dev/algod> (or use the Pera wallet faucet).
2. Paste an address **or** generate a fresh 25-word mnemonic locally:
   ```bash
   npx algosdk-cli account generate  # or via a wallet (Pera / MyAlgo)
   ```
3. Request TestNet ALGOs (free, instant). Keep ~5 ALGO for funding + fees.
4. Two accounts are needed:
   - **Merchant** (`MERCHANT_MNEMONIC`) — the account that owns the paid MCP resources and receives payments. Add this to the **resource server** env.
   - **Funder** (`FUNDING_MNEMONIC`, optional) — tops up agent wallets when they run dry. Add to the **API** env.

> Only ever set these in the host's `.env` / Render dashboard. Never commit real mnemonics — the repo's `.gitignore` excludes all `.env` files.

---

## Setting `SESSION_SECRET` / `ENCRYPTION_KEY`

Generate both once and reuse them across restarts so login sessions and encrypted wallet vaults stay stable:

```bash
# 32+ char secret (any string)
echo "SESSION_SECRET=$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')"
# 32-byte (64 hex char) AES-256 key
echo "ENCRYPTION_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
```

---

## Pointing the Dashboard at the Deployed API

The dashboard (`apps/dashboard`) is a Vite/React SPA — it is **not** in the compose stack. Build it with the deployed API URL baked in, then host the static `dist/` on any free static host (Netlify / Vercel / GitHub Pages / Cloudflare Pages):

```bash
VITE_KRON_API_URL=https://kron-api.onrender.com pnpm --filter @kron/dashboard build
# → deploy apps/dashboard/dist
```

Then set the API's `DASHBOARD_URL` to the dashboard origin (e.g. `https://kron-dashboard.netlify.app`) so CORS + credentials work.

**Dashboard login:** seeded admin — `admin@kron.dev` / the `SEED_ADMIN_PASSWORD` you set (falls back to a random password printed to the API logs on first boot).

---

## Judge Quick-Check

- [x] `https://<api>/healthz` returns 200
- [x] Dashboard loads and logs in
- [x] Create an agent, run a demo call, see an `AUTO_APPROVED` decision with a real TestNet tx ID
- [x] Verify the tx in the `/verify` portal and on <https://testnet.explorer.perawallet.app>