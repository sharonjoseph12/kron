import { describe, expect, it } from "vitest";
import { actionHash, canonicalJson } from "./hash.js";
import { proposeSafeVersion } from "./rewrite.js";
import type { ActionRequest, ImpactPreview } from "@kron/shared";

const preview: ImpactPreview = {
  kind: "send",
  summary: "",
  details: {},
  recipientKnown: false,
  recipient: "audit@supplier-docs.example",
  fileSensitivity: "customer-confidential",
  asOf: "",
};

const hero: ActionRequest = {
  agentId: "agent-1",
  sessionId: "sess-1",
  missionId: "mission-1",
  tool: "email.send",
  args: { to: "audit@supplier-docs.example", attachment: "contracts/coastal-catch-q3-signed.pdf" },
  nonce: "n1",
};

describe("canonical action hash", () => {
  it("is stable regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("changes whenever the action changes", () => {
    const base = actionHash(hero);
    expect(actionHash({ ...hero, args: { ...hero.args, to: "legal@coastalcatch.example" } })).not.toBe(base);
    expect(actionHash({ ...hero, nonce: "n2" })).not.toBe(base);
  });
});

describe("safe rewrite", () => {
  it("turns a hard delete into a recoverable archive", () => {
    const rewrite = proposeSafeVersion({
      action: { ...hero, tool: "db.delete", args: { table: "orders" } },
      kind: "delete",
      preview: { ...preview, kind: "delete", recoverable: false, rowsAffected: 1204 },
    });
    expect(rewrite?.action.args.soft).toBe(true);
    expect(rewrite?.differences.length).toBeGreaterThan(0);
  });

  it("redirects an external attachment to the internal owner and lists differences", () => {
    const rewrite = proposeSafeVersion({ action: hero, kind: "send", preview });
    expect(rewrite?.action.args.to).toBe("legal@coastalcatch.example");
    expect(rewrite?.differences.join(" ")).toContain("Recipient changes");
    expect(rewrite?.differences.join(" ")).toContain("not performed");
  });

  it("does not rewrite DROP TABLE", () => {
    expect(proposeSafeVersion({
      action: { ...hero, tool: "db.drop_table", args: { table: "orders" } },
      kind: "delete",
      preview: null,
    })).toBeNull();
  });
});
