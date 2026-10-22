import { describe, expect, it } from "vitest";
import { classifyAction } from "./classify.js";
import { evaluateRisk } from "./score.js";
import type { SessionFacts } from "./session.js";
import type { ImpactPreview } from "@kron/shared";

const clean: SessionFacts = { tainted: false, sensitiveRead: false };
const tainted: SessionFacts = { tainted: true, sensitiveRead: true, taintSource: "email.read:msg-poisoned", sensitiveSource: "files.read" };

const heroPreview: ImpactPreview = {
  kind: "send",
  summary: "send contract",
  details: {},
  recipient: "audit@supplier-docs.example",
  recipientKnown: false,
  filePath: "contracts/coastal-catch-q3-signed.pdf",
  fileSensitivity: "customer-confidential",
  asOf: "2026-10-22T10:00:00.000Z",
};

describe("action classifier", () => {
  it("classifies all five action kinds", () => {
    expect(classifyAction("orders.read")).toBe("read");
    expect(classifyAction("db.update")).toBe("write");
    expect(classifyAction("db.delete")).toBe("delete");
    expect(classifyAction("email.send")).toBe("send");
    expect(classifyAction("pay.market_data")).toBe("pay");
  });
});

describe("risk engine", () => {
  it("always blocks DROP TABLE", () => {
    const result = evaluateRisk({
      tool: "db.drop_table",
      args: { table: "orders" },
      kind: "delete",
      session: clean,
      preview: null,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons.join(" ")).toContain("never allows schema destruction");
  });

  it("holds the hero attack at 75/100 with plain-language reasons", () => {
    const result = evaluateRisk({
      tool: "email.send",
      args: { to: "audit@supplier-docs.example", attachment: "contracts/coastal-catch-q3-signed.pdf" },
      kind: "send",
      session: tainted,
      preview: heroPreview,
    });
    expect(result.score).toBe(75);
    expect(result.decision).toBe("HOLD");
    expect(result.reasons.join(" ")).toContain("Lethal trifecta");
    expect(result.reasons.join(" ")).toContain("customer-confidential");
  });

  it("allows the same send to a known contact in a clean session", () => {
    const result = evaluateRisk({
      tool: "email.send",
      args: { to: "legal@coastalcatch.example", attachment: "contracts/coastal-catch-q3-signed.pdf" },
      kind: "send",
      session: clean,
      preview: { ...heroPreview, recipientKnown: true, recipient: "legal@coastalcatch.example" },
    });
    expect(result.decision).toBe("FLAG");
    expect(result.reasons.join(" ")).not.toContain("Lethal trifecta");
  });

  it("holds a hard bulk delete but blocks nothing for a scoped read", () => {
    const deleteResult = evaluateRisk({
      tool: "db.delete",
      args: { table: "orders" },
      kind: "delete",
      session: clean,
      preview: { kind: "delete", summary: "delete 1204", details: {}, rowsAffected: 1204, sensitiveRows: 37, recoverable: false, asOf: "" },
    });
    expect(deleteResult.decision).toBe("HOLD");
    expect(deleteResult.score).toBe(65);

    const readResult = evaluateRisk({
      tool: "orders.read",
      args: {},
      kind: "read",
      session: clean,
      preview: null,
    });
    expect(readResult.decision).toBe("ALLOW");
  });
});
