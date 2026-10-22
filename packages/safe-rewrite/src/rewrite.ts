import type { ActionRequest, ActionKind, ImpactPreview } from "@kron/shared";

export interface RewriteInput {
  action: ActionRequest;
  kind: ActionKind;
  preview: ImpactPreview | null;
  internalOwner?: string;
  perCallLimitAlgo?: number;
  sessionBudgetAlgo?: number;
}

export interface ProposedRewrite {
  action: ActionRequest;
  label: string;
  differences: string[];
}

/**
 * Deterministic, rules-only safe alternatives. Every rewrite is an
 * alternative, not an equivalent, and is revalidated by the caller.
 */
export function proposeSafeVersion(input: RewriteInput): ProposedRewrite | null {
  const { action, kind, preview } = input;
  const { tool, args } = action;

  if (tool === "db.drop_table" || tool === "db.truncate") return null;

  if (kind === "delete" && tool === "db.delete" && args.soft !== true) {
    return {
      action: {
        ...action,
        args: { ...args, soft: true },
        nonce: `${action.nonce ?? "nonce"}-safe`,
      },
      label: "Archive instead of delete",
      differences: [
        "Hard delete becomes a soft delete (archive flag).",
        "Rows stay recoverable for 30 days.",
        "The impact preview is recomputed on the rewritten action.",
      ],
    };
  }

  if (kind === "write" && tool === "db.update" && !args.where) {
    return {
      action: {
        ...action,
        args: { ...args, where: { status: "pending" } },
        nonce: `${action.nonce ?? "nonce"}-safe`,
      },
      label: "Scope the update to pending orders",
      differences: [
        "An unscoped UPDATE gains a WHERE clause (status = pending).",
        "Rows outside the task scope are not changed.",
        "The impact preview is recomputed on the rewritten action.",
      ],
    };
  }

  if (kind === "send" && tool === "email.send" && preview?.recipientKnown === false) {
    const owner = input.internalOwner ?? "legal@coastalcatch.example";
    return {
      action: {
        ...action,
        args: {
          ...args,
          to: owner,
          subject: `[Internal review] ${String(args.subject ?? "Document review")}`,
          body: `Internal review copy. Original external recipient: ${String(args.to ?? "unknown")}.\n\n${String(args.body ?? "")}`,
        },
        nonce: `${action.nonce ?? "nonce"}-safe`,
      },
      label: "Send to the internal owner for review",
      differences: [
        `Recipient changes from ${String(args.to ?? "the new outside address")} to ${owner}.`,
        "The contract stays inside the company.",
        "The email is marked for internal review; the original external send is not performed.",
      ],
    };
  }

  if (kind === "pay") {
    const amount = Number(args.amountAlgo ?? 0);
    const cap = input.perCallLimitAlgo;
    if (Number.isFinite(amount) && cap != null && amount > cap) {
      return {
        action: {
          ...action,
          args: { ...args, amountAlgo: cap },
          nonce: `${action.nonce ?? "nonce"}-safe`,
        },
        label: `Pay the capped amount (${cap} ALGO)`,
        differences: [
          `Payment changes from ${amount} ALGO to the ${cap} ALGO autonomous cap.`,
          "Anything above the cap still needs a separate human decision.",
          "The payment policy is re-run on the rewritten action.",
        ],
      };
    }
  }

  return null;
}
