# Security Policy

KRON is a capability firewall: every dangerous agent action is classified,
previewed against live data, risk-scored, and gated by a hash-bound human
approval before a one-shot capability grant is issued.

That makes the security posture of KRON itself worth scrutinising. Reports are
welcome.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main` (latest) | Yes |
| Older commits / forks | No |

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

- Email: **sharon271206@gmail.com**
- Or use GitHub's [private vulnerability reporting](https://github.com/sharonjoseph12/kron/security/advisories/new).

Please include:

1. A description of the issue and its impact.
2. Reproduction steps or a proof-of-concept.
3. The affected package or app (e.g. `@kron/policy-engine`, `apps/api`).
4. The commit or version you tested.

You can expect an acknowledgement within 72 hours. Please allow time for a fix
before any public disclosure.

## Scope

In scope:

- Policy-engine bypasses (spending limits, recipient filters, daily budgets).
- Approval-forgery or replay of a capability grant / enforcement receipt.
- Drift-detection bypasses where a stale approval still executes.
- Authentication or RBAC flaws in `apps/api`.
- Secret leakage in the repository.

Out of scope:

- Issues in third-party dependencies that are already publicly disclosed.
- The public sandbox demo's deliberately seeded, non-sensitive data.
- The TestNet-only demo wallets, which hold no real funds.

## Handling Secrets

`.env` files are git-ignored; only `*.env.example` templates are committed. If
you believe a real secret was committed, report it privately so it can be
rotated before history is rewritten.
