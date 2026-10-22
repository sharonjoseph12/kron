# KRON — Screenshots (for README + One-Pager + Submission)

> Capture these 5 screenshots after `pnpm bootstrap && pnpm dev` + `pnpm demo:run` so the dashboard shows live on-chain data. Login: the credentials in `data/demo-credentials.txt`.

## 1. Dashboard — Economic Overview
- URL: `http://localhost:5173/`
- Shows: hero settlement card (On-chain badge + Atomic Group App #), 12 stat cards, fleet health 0-100, spend 14d line, decision pie, burn/runway, recent payments table with AlgoExplorer links, live SSE feed.
- Capture: full page scrolled to contract card.

## 2. Agents — Policy Console
- URL: `http://localhost:5173/agents`
- Shows: 2 agents (Researcher 0.05 ALGO, Trader 0.50 ALGO), expand one → wallet address + policy editor + version history + timeline drawer with `REQUEST → 402 → AUTHORIZED → SIGNED → CONFIRMED → PROOF_VERIFIED`.
- Capture: with PolicyEditor open.

## 3. Simulation — What-If Engine
- URL: `http://localhost:5173/simulation`
- Steps: set `Per-Call Autonomous Limit` to `0.02`, `Lookback 100`, click `Run What-If Simulation`. Shows bar chart current vs simulated + blocked audit + `ACTIVATE POLICY`.
- Capture: after simulation completes.

## 4. Verify — On-Chain Proof
- URL: `http://localhost:5173/verify`
- Steps: paste any `txId` from Payments feed, click `Verify Proof`. Shows `CRYPTOGRAPHICALLY VERIFIED` banner, app call tx, round, policyHash, decision reasons, `View Block on AlgoExplorer`.
- Capture: verified state.

## 5. Playground — SDK Sandbox
- URL: `http://localhost:5173/playground`
- Shows: snippet selector `2. Agent-to-Agent (A2A) Autonomous Hiring`, `Run in Sandbox` → console with 0.035 ALGO A2A hire + on-chain proof section + SDK code preview.
- Capture: with console output.

## How to export
```bash
# Use Chrome/Edge → F12 → Ctrl+Shift+P → "Capture full size screenshot"
# Or: npx playwright screenshot http://localhost:5173 --full-page --wait-for-timeout 3000 screenshot-dashboard.png
```
Add to README:
```md
![Dashboard](./docs/screenshots/dashboard.png)
![Simulation](./docs/screenshots/simulation.png)
![Verify](./docs/screenshots/verify.png)
```

## Offline note
Screenshots are the fallback if Docker/localnet is slow during the demo — judges see the same proof without a live chain.
