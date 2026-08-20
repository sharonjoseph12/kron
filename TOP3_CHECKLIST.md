# KRON — Top 3 Hackathon Checklist

## Pre-Hackathon (Now — Day 0)

### Code Quality
- [x] 68/68 tests passing (`pnpm test` + `pnpm --filter @kron/api test`)
- [x] TypeScript typecheck clean across all 8 packages (`pnpm typecheck`)
- [x] Build succeeds for all packages (`pnpm build`)
- [x] TEAL contract source saved to `packages/x402/teal/`
- [x] TEAL compile script added (`pnpm --filter @kron/x402 compile:teal`)
- [x] Smart contract auto-deploys on first payment (`ensureKronApp`)
- [x] Hardcoded `KRON_APP_ID=1023` removed from `.env`
- [x] ARC-4 ABI contract with method dispatch (`anchor_policy`, `get_payment_count`, `get_last_policy_hash`)
- [x] `/api/contract` endpoint reads live app global state from the indexer
- [x] Dashboard "Policy Anchor Contract" card shows on-chain state
- [x] USDC (ASA) priced resource + atomic group asset-transfer settlement
- [x] API integration test suite (11 tests, `pnpm --filter @kron/api test`)

### Documentation
- [x] `README.md` updated with architecture + offline docs links
- [x] `HACKATHON.md` — one-page judge summary
- [x] `OFFLINE.md` — 24-hour offline runbook
- [x] `docs/ARCHITECTURE.md` — architecture diagrams + data flow
- [x] `DEMO_REHEARSAL.md` — timed 3-minute pitch script
- [x] `scripts/offline-bootstrap.ps1` — one-command Windows bootstrap
- [x] `scripts/bootstrap-contract.ts` — standalone contract deploy

### Remaining (Do Before Submission)
- [ ] Record 2-3 minute demo video (follow `DEMO_REHEARSAL.md`)
- [ ] Convert `HACKATHON.md` to a one-page PDF (use Markdown -> PDF tool)
- [ ] Screenshot the 5 key dashboard pages (Dashboard, Agents, Simulation, Verify, Playground)
- [ ] Add screenshots to `README.md` or a separate `docs/SCREENSHOTS.md`
- [ ] Test the full offline flow on a clean machine or VM
- [ ] Push to GitHub (ensure `.env` files are NOT committed)

## Day 1-2: Hardening

### Critical Path
1. **Verify Docker localnet**: Run `docker compose --profile localnet up -d` and confirm algod starts
2. **Verify offline bootstrap**: Run `.\scripts\offline-bootstrap.ps1` on a clean terminal
3. **Run all 3 demos**:
   ```bash
   pnpm demo:multi
   pnpm demo:a2a
   pnpm demo:budget
   ```
4. **Fix any flaky timing**: The demo agent has `await` calls; add delays if Algorand localnet is slow

### Deployment & Credibility
- [ ] Push to GitHub (main branch) with green CI — see `docs/DEPLOYMENT.md`
- [ ] Deploy a live hosted instance (VPS / Railway / Render) — see `docs/DEPLOYMENT.md`

### Polish
- [ ] Add loading skeletons to dashboard pages
- [ ] Ensure dashboard works on 1366x768 laptop screen
- [ ] Fix any console errors in browser devtools
- [ ] Test on Chrome + Firefox

## Day 3-4: Assets

### Demo Video
- [ ] Record screen + voiceover (OBS Studio)
- [ ] Script exactly follows `DEMO_REHEARSAL.md`
- [ ] Keep under 3 minutes
- [ ] Upload to YouTube / Google Drive / Loom
- [ ] Add link to `HACKATHON.md`

### One-Pager PDF
- [ ] Open `HACKATHON.md` in Markdown editor
- [ ] Export to PDF (e.g., using Pandoc, Markdown to PDF, or VS Code Print)
- [ ] Include QR code to playground (generate at qr-code-generator.com)
- [ ] Print one copy for the live demo

## Day 5-6: Final Rehearsal

### Run the Full Demo 3 Times
- [ ] Time each run (target: < 3 min for pitch, < 5 min for full demo)
- [ ] Have a backup plan for each slide (see `DEMO_REHEARSAL.md` Fallback Plan)
- [ ] Practice answering the top 5 judge questions (in `PITCH.md`)

### Offline Package Verification
- [ ] Unzip / copy project to a USB drive
- [ ] Boot a clean machine (or VM) with only Node + Docker + Git
- [ ] Run `.\scripts\offline-bootstrap.ps1`
- [ ] Verify dashboard loads and demos work
- [ ] Time the entire bootstrap (target: < 10 min)

## Day 7: Submission

### Final Checks
- [ ] All tests pass
- [ ] Typecheck clean
- [ ] Build succeeds
- [ ] Demo video link works
- [ ] One-pager PDF looks good
- [ ] Submission form filled out with correct links

### Submission Package
```
kron-hackathon-submission/
├── README.md
├── HACKATHON.md
├── PITCH.md
├── SUBMISSION.md
├── OFFLINE.md
├── DEMO_REHEARSAL.md
├── docs/
│   ├── ARCHITECTURE.md
│   └── SCREENSHOTS.md
├── KRON_One_Pager.pdf
└── demo-video-link.txt
```

## Key Metrics for Judges

| Metric | Value |
|---|---|
| Tests Passing | 68/68 |
| TypeCheck | Clean (9/9 packages) |
| Build Time | < 30s |
| Policy Evaluation | < 5ms |
| On-Chain Finality | 3.3s (Algorand) |
| Transaction Fee | < $0.0002 |
| Dashboard Pages | 9 |
| SDK Integration | 5 lines of code |
| Contract Methods | 3 (ARC-4: anchor_policy, get_payment_count, get_last_policy_hash) |
| Payment Rails | ALGO + USDC/USDT (ASA) |

## Top 3 Secret Sauce

1. **Real on-chain settlement**: Not a mock. Every payment hits Algorand (localnet/testnet) and the `/verify` portal re-checks the ledger independently.
2. **Complete traceability**: `Agent → Session → ToolCall → PaymentRequest → PaymentDecision → Settlement` with full audit log.
3. **Judge-friendly UX**: Interactive Playground lets judges click through the SDK without reading code.
4. **Offline-ready**: One PowerShell script bootstraps everything. No internet needed after `pnpm install`.
5. **Production-grade policy engine**: 21+ deterministic rules, velocity anomaly detection, what-if simulation.
6. **A2A hiring**: Agents hiring agents with autonomous on-chain settlement — a narrative judges remember.
