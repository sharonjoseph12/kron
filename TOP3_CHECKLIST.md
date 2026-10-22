# KRON — Top-3 Submission Checklist (PS 2.1)

> Primary mechanism: **capability firewall** — preview the blast radius, bind the approval, prove the enforcement.
> Submission format: **video + PPT**. No live website link required.

---

## 1. Code & Proof — Done

- [x] One generic action gateway for read / write / delete / send / pay
- [x] Rolled-back impact preview against the real sandbox database
- [x] Rules-only risk engine with lethal-trifecta detection and hard blocks
- [x] Deterministic safe rewrites, revalidated through the same pipeline
- [x] Approvals bound to `sha256(canonical action JSON)`
- [x] Dataset fingerprint binding (`previewFingerprint`, `safePreviewFingerprint`)
- [x] Stale approval invalidation with HTTP **409**
- [x] One-shot capability grants (agent + tool + hash, atomic consume, 60s expiry)
- [x] Hash-chained enforcement receipts with before/after state + `toolInvoked`
- [x] Hash-chained control audit + tamper detection
- [x] Dashboard approval desk, impact card, safe version, drift panel, proof pane, receipts
- [x] Deterministic sandbox: 1,204 orders, 37 sensitive rows, `.example` mail sink
- [x] `pnpm demo:reset` / `pnpm demo:attack all` / `pnpm demo:proof`
- [x] Baseline counterfactual leaks exactly one email
- [x] No default credentials; random operator credentials in gitignored `data/`
- [x] Algorand TestNet only for the preserved x402 payment rail

### Verified numbers (from real runners)

| Metric | Value |
|---|---|
| Hero risk | **75/100**, HOLD |
| Hero attacker inbox | **0** |
| Bulk delete preview | **1,204 rows**, **37 sensitive**, not recoverable |
| Bulk delete approved | archive **1,204** |
| Baseline | attacker inbox **1** |
| Drift card → live | **826 → 786** after **40** concurrent changes |
| Stale approval | **409**, `toolInvoked: false`, archived **0** |
| Fresh approval | archives exactly **786** |
| Deterministic runs | **30/30** |
| Automated tests | **124** |
| Typecheck / build | **12 workspaces clean** |

---

## 2. Submission Assets — Remaining

- [x] `VIDEO_SCRIPT.md` — 2:45 script with exact numbers
- [x] `PPT_OUTLINE.md` — 12 slides + speaker notes
- [x] `PITCH.md` — 3-minute pitch + Q&A
- [x] `SUBMISSION.md` — submission write-up
- [x] `JUDGE_PREP.md` — judge Q&A
- [x] `DEMO_REHEARSAL.md` — setup, clicks, fallbacks
- [ ] Record the screen + voiceover (follow `VIDEO_SCRIPT.md`)
- [ ] Export the PPT from `PPT_OUTLINE.md` (12 slides, 16:9)
- [ ] Watch the recording once with sound off; every number must be legible
- [ ] Confirm no `.env`, credentials file, or secret appears on screen
- [ ] Upload the video and paste the link into the submission form
- [ ] Submit `PPT.pdf` + video link

---

## 3. Pre-Recording

```bash
pnpm install
pnpm demo:reset
pnpm dev
# http://localhost:5173/control
# credentials: data/demo-credentials.txt
```

```bash
pnpm demo:attack all
pnpm demo:proof
pnpm test
pnpm typecheck
pnpm build
```

- [ ] Clean proof pane: orders 1,204 · sensitive 37 · attacker 0
- [ ] Hero: risk 75 · HOLD · attacker 0
- [ ] Delete: 1,204 / 37 · archive 1,204
- [ ] Drift: 826 → 786 · stale 409 · 0 executed · fresh 786
- [ ] Receipts: chain verified · download works
- [ ] Terminal: `30/30 deterministic scenarios passed`

---

## 4. Top-3 Differentiators

1. **Drift-bound consent** — the approval is invalid when the live dataset changes, not just when the JSON changes.
2. **One-shot capability grants** — a decision and an invocation are different objects; the adapter refuses to run without a fresh grant.
3. **Proof of enforcement** — hash-chained receipts with before/after state and `toolInvoked`, downloadable as JSON.
4. **Real blast radius** — rolled-back previews over the actual data, with sensitive-row and recoverability counts.
5. **Measured counterfactual** — the product ships the losing baseline so the difference is empirical, not rhetorical.

---

## 5. Honest Boundaries (do not overclaim)

- Sandbox data is seeded; queries and mutations are real.
- No production red-team or benchmark was run.
- Email is an in-app sink; no real mail.
- Algorand is TestNet; no real funds.
- Live adapters, mission contracts, recovery/undo and PS 2.2 privacy are next.

---

## 6. Submission Package

```
kron-submission/
├── KRON_PS21_Deck.pdf          # exported from PPT_OUTLINE.md
├── VIDEO_SCRIPT.md             # reference / narration
├── video-link.txt              # uploaded link
├── SUBMISSION.md
├── PITCH.md
├── JUDGE_PREP.md
└── DEMO_REHEARSAL.md
```
