import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeSandbox, openSandbox, resetSandbox, setSandboxPath } from "./db.js";
import { executeSandboxTool, previewDelete, previewEmail, proofPane, HERO, orderStats } from "./tools.js";
import type { Database } from "sql.js";

let dir = "";
let db: Database;

describe("sandbox business tools", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kron-sandbox-"));
    setSandboxPath(join(dir, "sandbox.db"));
    await resetSandbox();
    db = await openSandbox();
  });

  afterAll(() => {
    closeSandbox();
    rmSync(dir, { recursive: true, force: true });
  });

  it("seeds 1,204 orders and computes 37 sensitive rows from SQL", () => {
    const preview = previewDelete(db, { table: "orders", hard: true });
    expect(preview.rowsAffected).toBe(1204);
    expect(preview.sensitiveRows).toBe(37);
    expect(preview.recoverable).toBe(false);
    expect(preview.summary).toContain("1,204");
    expect(preview.summary).toContain("37");
  });

  it("preview matches execution for a hard delete, then reset restores rows", async () => {
    const preview = previewDelete(db, { table: "orders", where: { status: "cancelled" } });
    const result = executeSandboxTool(db, "db.delete", { table: "orders", where: { status: "cancelled" } });
    expect(result.affectedRows).toBe(preview.rowsAffected);
    expect(orderStats(db).total).toBe(1204 - preview.rowsAffected!);
    await resetSandbox();
    db = await openSandbox();
    expect(orderStats(db).total).toBe(1204);
  });

  it("describes the hero attachment and new outside recipient", () => {
    const preview = previewEmail(db, {
      to: HERO.attacker,
      subject: "Contract",
      attachment: HERO.contract,
    });
    expect(preview.recipientKnown).toBe(false);
    expect(preview.fileSensitivity).toBe("customer-confidential");
    expect(preview.summary).toContain("customer-confidential");
    expect(preview.summary).toContain("new recipient");
  });

  it("sends nothing to the attacker until the email tool executes", () => {
    expect(proofPane(db).mail.attackerMessages).toBe(0);
    const result = executeSandboxTool(db, "email.send", {
      to: HERO.attacker,
      subject: "Contract",
      attachment: HERO.contract,
    });
    expect(result.affectedRows).toBe(1);
    expect(proofPane(db).mail.attackerMessages).toBe(1);
  });
});
