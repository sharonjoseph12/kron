import type { ActionKind } from "@kron/shared";

/** Deterministic, rules-only classifier. No model, no network. */
export function classifyAction(tool: string): ActionKind {
  const name = tool.toLowerCase();
  if (name.includes("drop") || name.includes("truncate") || name.startsWith("db.delete") || name === "db.delete") return "delete";
  if (name.startsWith("db.update") || name.startsWith("db.insert") || name.startsWith("db.write") || name === "db.update") return "write";
  if (name.startsWith("email.send") || name.startsWith("files.upload") || name.startsWith("http.post") || name === "email.send") return "send";
  if (name.startsWith("pay.") || name.includes("payment") || name === "x402.pay") return "pay";
  return "read";
}

export function irrepressible(tool: string, args: Record<string, unknown>): boolean {
  if (tool === "db.delete") return args.soft !== true;
  if (tool === "db.drop_table") return true;
  return false;
}
