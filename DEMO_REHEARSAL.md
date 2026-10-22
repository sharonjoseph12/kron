# KRON Demo Rehearsal (PS 2.1)

> Target: **2:45 video**, 3:00 hard stop.
> Every number in the script is produced by the deterministic runner. Rehearse with the same commands.

---

## Setup (5 minutes)

```bash
pnpm install
pnpm demo:reset
pnpm dev
```

1. Open `http://localhost:5173/control`.
2. Log in with the email/password in `data/demo-credentials.txt` (generated locally, gitignored, never a default).
3. Confirm the proof pane reads: **orders 1,204 · sensitive 37 · attacker inbox 0**.
4. Open a second terminal at the repo root for backup proof commands.

### Pre-flight (30 seconds)

```bash
pnpm demo:attack all
pnpm demo:proof
```

Expected:

```
PASS  hero      HOLD → safe internal send · attacker 0
PASS  delete    HOLD → archive 1,204 · attacker 0
PASS  baseline  raw approval → attacker inbox 1
PASS  drift     stale 826 → live 786 · rejected 409 · 786 archived

30/30 deterministic scenarios passed
```

Then run `pnpm demo:reset` once more before recording so the dashboard opens on a clean slate.

---

## Timeline

| Time | Beat | Action | Number to say |
|---|---|---|---|
| 0:00 | The gap | Split screen / title | “A log line is not a control.” |
| 0:20 | Mechanism | Show `/control` pipeline | “One path. No bypass.” |
| 0:45 | Hero attack | Click **Run hero attack**; select email card | risk **75/100**, HOLD |
| 1:05 | Safe version | Click **Approve safe version** | attacker **0** |
| 1:25 | Bulk delete | Click **Bulk delete**; approve archive | **1,204** rows, **37** sensitive |
| 1:55 | Drift | Click **Shadow drift** | **826 → 40 → 786**, stale **409**, fresh **786** |
| 2:25 | Receipts | Scroll to **Enforcement receipts**; click **Download** | `toolInvoked` + before/after |
| 2:35 | Proof | Cut to terminal or show badge | **30/30**, **124 tests** |
| 2:40 | Close | Title card | “Cap its actions.” |

---

## What to click, exactly

### Hero attack
1. `Run hero attack`.
2. The timeline adds: read poisoned email → read contract → send held.
3. Select the `email.send` card.
4. Point at: **risk 75/100**, lethal trifecta reason, attachment `customer-confidential`, recipient **New**.
5. Point at the safe version: **Send to the internal owner for review**.
6. Click **Approve safe version**.
7. Proof pane: **attacker inbox 0**, outbound 1.

### Bulk delete
1. `Bulk delete`.
2. Select the `db.delete` card.
3. Point at: **1,204 rows**, **37 sensitive**, **Recoverable: No**.
4. Safe version: **Archive instead of delete**.
5. Click **Approve safe version**.
6. Proof pane: **1,204 archived**, total **1,204**, attacker **0**.

### Shadow drift
1. `Shadow drift`.
2. The drift panel appears:
   - card preview **826**
   - concurrent change **40**
   - live **786**
   - executed by stale card **0**
   - stale **409** with receipt id
   - fresh archive **786**, active **418**
3. Scroll to receipts; the stale receipt shows `blocked`, `toolInvoked: false`, `drift`.
4. Download one receipt JSON.

---

## Fallback Plan

| Failure | Fallback |
|---|---|
| Dashboard won't load | Run `pnpm demo:attack all`; narrate the terminal output. |
| Browser animation stalls | Cut the wait; keep the final proof numbers. |
| Click does not register | Use the API runner directly; the numbers are identical. |
| Receipt panel is empty | Run any scenario; every decision writes a receipt. |
| Drift button fails | Run `pnpm demo:attack drift`; it executes the same service path. |
| Demo database is dirty | `pnpm demo:reset` (≈3s). |

---

## Recording Rules

- 1920×1080, browser zoom 100%, light theme.
- Never show `.env`, `data/demo-credentials.txt`, or terminal history with secrets.
- Do not claim a benchmark or red-team result that is not printed by `demo:attack` / `demo:proof`.
- Do not imply real email or real money. Say “sandbox” and “Algorand TestNet”.
- Keep the video under 3:00. The deck can carry the detail.

---

## Final Checklist

- [ ] `pnpm demo:reset` run immediately before recording
- [ ] `/control` loads and proof pane shows 1,204 / 37 / 0
- [ ] Hero: risk 75, HOLD, attacker 0
- [ ] Delete: 1,204 / 37, archive 1,204
- [ ] Drift: 826 / 40 / 786, stale 409, 0 executed, fresh 786
- [ ] Receipts: chain verified, download works
- [ ] Terminal backup: `30/30 deterministic scenarios passed`
- [ ] No secrets on screen
- [ ] Video exported at 1080p, under 3:00
