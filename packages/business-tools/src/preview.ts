import type { Database } from "sql.js";
import type { ImpactPreview } from "@kron/shared";
import { previewDelete, previewEmail, previewUpdate } from "./tools.js";

/** Compute a real impact preview for a sandbox action. */
export function previewSandboxAction(db: Database, tool: string, args: Record<string, unknown>): ImpactPreview | null {
  switch (tool) {
    case "db.delete":
      return previewDelete(db, args);
    case "db.update":
      return previewUpdate(db, args);
    case "email.send":
      return previewEmail(db, args);
    default:
      return null;
  }
}
