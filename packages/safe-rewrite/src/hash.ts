import { createHash } from "node:crypto";
import type { ActionRequest } from "@kron/shared";

/** Stable JSON: object keys sorted recursively, arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Approvals are bound to exactly these four fields. Any change to the tool,
 * arguments, mission or nonce produces a different hash and needs a new
 * human approval.
 */
export function actionHash(action: ActionRequest): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        tool: action.tool,
        args: action.args,
        missionId: action.missionId ?? null,
        nonce: action.nonce ?? null,
      }),
    )
    .digest("hex");
}
