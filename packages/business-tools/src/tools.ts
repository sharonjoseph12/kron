import type { Database } from "sql.js";
import type { ImpactPreview, ProofPaneDTO } from "@kron/shared";
import { all, nowIso, one, previewTransaction, scalar } from "./db.js";

export const ATTACKER_ADDRESS = "audit@supplier-docs.example";
export const INTERNAL_DOMAIN = "coastalcatch.example";
export const INTERNAL_OWNER = "legal@coastalcatch.example";
export const HERO_CONTRACT = "contracts/coastal-catch-q3-signed.pdf";

export interface SandboxTool {
  name: string;
  description: string;
  kind: "read" | "write" | "delete" | "send" | "pay";
}

export const SANDBOX_TOOLS: SandboxTool[] = [
  { name: "email.read", description: "Read an inbound supplier email", kind: "read" },
  { name: "email.send", description: "Send an email, optionally with a file attachment", kind: "send" },
  { name: "files.read", description: "Read a file from the company file store", kind: "read" },
  { name: "files.list", description: "List files and sensitivity tags", kind: "read" },
  { name: "orders.read", description: "Read order counts from the sandbox database", kind: "read" },
  { name: "db.delete", description: "Delete rows from a sandbox table (hard or soft)", kind: "delete" },
  { name: "db.update", description: "Update rows in a sandbox table", kind: "write" },
  { name: "db.drop_table", description: "Drop a database table", kind: "delete" },
  { name: "pay.market_data", description: "Buy a paid market data resource through x402", kind: "pay" },
];

type WhereValue = string | number | boolean | null;
type SqlValue = string | number | null;
type Where = Record<string, WhereValue>;

const TABLE_COLUMNS: Record<string, string[]> = {
  orders: ["id", "customer_id", "amount", "status", "archived_at"],
  customers: ["id", "name", "email", "sensitivity"],
};

function toSql(value: WhereValue): SqlValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function assertTable(table: unknown): string {
  const name = typeof table === "string" ? table : "orders";
  if (!(name in TABLE_COLUMNS)) throw new Error(`Sandbox table "${name}" is not writable`);
  return name;
}

function whereSql(table: string, where: Where | undefined, alias?: string): { sql: string; params: SqlValue[] } {
  if (!where || Object.keys(where).length === 0) return { sql: "", params: [] };
  const allowed = TABLE_COLUMNS[table] ?? [];
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (!allowed.includes(key)) throw new Error(`Sandbox column "${key}" is not filterable`);
    const prefix = alias ? `${alias}.` : "";
    clauses.push(`${prefix}${key} = ?`);
    params.push(toSql(value));
  }
  return { sql: ` WHERE ${clauses.join(" AND ")}`, params };
}

function sensitiveWhere(table: string, where: Where | undefined): { sql: string; params: SqlValue[] } {
  const base = whereSql(table, where, table === "orders" ? "o" : undefined);
  if (table !== "orders") return base;
  const extra =
    "(c.sensitivity = 'high' OR EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.status = 'open'))";
  return {
    sql: base.sql ? `${base.sql} AND ${extra}` : ` WHERE ${extra}`,
    params: base.params,
  };
}

export function fileRow(db: Database, path: string) {
  return one<{ path: string; name: string; sensitivity: string; content: string }>(
    db,
    "SELECT path,name,sensitivity,content FROM files WHERE path = ?",
    [path],
  );
}

export function isKnownContact(db: Database, email: string): boolean {
  return Boolean(one(db, "SELECT email FROM contacts WHERE lower(email) = lower(?) AND known = 1", [email.trim()]));
}

export function previewDelete(db: Database, args: Record<string, unknown>): ImpactPreview {
  const table = assertTable(args.table);
  const where = (args.where as Where | undefined) ?? undefined;
  const soft = args.soft === true;
  const filter = whereSql(table, where);
  const sensitive = sensitiveWhere(table, where);

  const result = previewTransaction(db, () => {
    const sensitiveRows = table === "orders"
      ? scalar(db, `SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id${sensitive.sql}`, sensitive.params)
      : 0;
    const before = scalar(db, `SELECT COUNT(*) FROM ${table}${filter.sql}`, filter.params);
    if (soft && table === "orders") {
      db.run(`UPDATE orders SET archived_at = ?${filter.sql}`, [nowIso(), ...filter.params]);
    } else {
      db.run(`DELETE FROM ${table}${filter.sql}`, filter.params);
    }
    const affected = db.getRowsModified();
    return { sensitiveRows, before, affected };
  });

  return {
    kind: "delete",
    summary: soft
      ? `Archives ${result.affected.toLocaleString("en-US")} orders. Recoverable for 30 days. ${result.sensitiveRows} belong to customers with open shipments.`
      : `Deletes ${result.affected.toLocaleString("en-US")} orders. ${result.sensitiveRows} belong to customers with open shipments. Not recoverable.`,
    details: {
      table,
      scope: where ? JSON.stringify(where) : "all rows (no WHERE clause)",
      rowsAffected: result.affected,
      sensitiveRows: result.sensitiveRows,
      recoverable: soft,
      mode: soft ? "soft delete (archive)" : "hard delete",
    },
    rowsAffected: result.affected,
    sensitiveRows: result.sensitiveRows,
    recoverable: soft,
    asOf: nowIso(),
  };
}

export function previewUpdate(db: Database, args: Record<string, unknown>): ImpactPreview {
  const table = assertTable(args.table);
  const where = (args.where as Where | undefined) ?? undefined;
  const set = (args.set as Where | undefined) ?? {};
  const allowed = TABLE_COLUMNS[table] ?? [];
  const keys = Object.keys(set);
  if (keys.length === 0) throw new Error("db.update requires a set object");
  for (const key of keys) if (!allowed.includes(key)) throw new Error(`Sandbox column "${key}" is not writable`);

  const filter = whereSql(table, where);
  const sensitive = sensitiveWhere(table, where);
  const assignments = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => toSql(set[k] as WhereValue));

  const result = previewTransaction(db, () => {
    const sensitiveRows = table === "orders"
      ? scalar(db, `SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id${sensitive.sql}`, sensitive.params)
      : 0;
    db.run(`UPDATE ${table} SET ${assignments}${filter.sql}`, [...values, ...filter.params]);
    return { sensitiveRows, affected: db.getRowsModified() };
  });

  return {
    kind: "write",
    summary: where
      ? `Updates ${result.affected.toLocaleString("en-US")} rows in ${table}. ${result.sensitiveRows} are sensitive.`
      : `Updates ${result.affected.toLocaleString("en-US")} rows in ${table} with no WHERE clause. ${result.sensitiveRows} are sensitive.`,
    details: {
      table,
      scope: where ? JSON.stringify(where) : "all rows (no WHERE clause)",
      rowsAffected: result.affected,
      sensitiveRows: result.sensitiveRows,
      changes: JSON.stringify(set),
      recoverable: false,
    },
    rowsAffected: result.affected,
    sensitiveRows: result.sensitiveRows,
    recoverable: false,
    asOf: nowIso(),
  };
}

export function previewEmail(db: Database, args: Record<string, unknown>): ImpactPreview {
  const to = typeof args.to === "string" ? args.to.trim() : "";
  const attachment = typeof args.attachment === "string" ? args.attachment : null;
  const file = attachment ? fileRow(db, attachment) : null;
  const known = Boolean(to) && isKnownContact(db, to);
  const domain = to.split("@")[1] ?? "unknown";
  const external = domain !== INTERNAL_DOMAIN;
  const highSensitivity = file?.sensitivity === "customer-confidential";
  const summary = file
    ? `Sends "${file.name}" (${file.sensitivity}) to ${to}, ${known ? "a known contact" : "a new recipient"}${external ? " outside the company" : " inside the company"}.`
    : `Sends an email to ${to}, ${known ? "a known contact" : "a new recipient"}${external ? " outside the company" : " inside the company"}.`;

  return {
    kind: "send",
    summary,
    details: {
      to,
      recipientKnown: known,
      domain,
      external,
      file: file?.name ?? null,
      filePath: file?.path ?? null,
      fileSensitivity: file?.sensitivity ?? null,
      highSensitivity,
    },
    recipient: to,
    recipientKnown: known,
    filePath: file?.path ?? undefined,
    fileSensitivity: file?.sensitivity ?? undefined,
    asOf: nowIso(),
  };
}

export interface ExecuteResult {
  ok: boolean;
  affectedRows: number;
  summary: string;
  detail: Record<string, unknown>;
}

/**
 * Execute inside a transaction and abort if the real affected-row count
 * differs from the preview. The mismatch hook exists only for tests/demos of
 * FR-8 and never changes production data.
 */
export function executeVerified(
  db: Database,
  tool: string,
  args: Record<string, unknown>,
  expectedRows: number | null,
): { ok: boolean; result: ExecuteResult | null; reason: string | null } {
  db.run("BEGIN");
  try {
    const result = executeSandboxTool(db, tool, args);
    const expected = process.env.KRON_FORCE_PREVIEW_MISMATCH === "true" && expectedRows != null ? expectedRows + 1 : expectedRows;
    if (expected != null && result.affectedRows !== expected) {
      db.run("ROLLBACK");
      return {
        ok: false,
        result: null,
        reason: `Preview said ${expected} row(s) would change, but execution reported ${result.affectedRows}. Aborted without committing.`,
      };
    }
    db.run("COMMIT");
    return { ok: true, result, reason: null };
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

export function executeSandboxTool(db: Database, tool: string, args: Record<string, unknown>): ExecuteResult {
  if (tool === "email.send") {
    const to = typeof args.to === "string" ? args.to.trim() : "";
    if (!to) throw new Error("email.send requires a recipient");
    const id = `out-${String(scalar(db, "SELECT COUNT(*) FROM messages WHERE direction = 'outbound'") + 1).padStart(4, "0")}`;
    db.run(
      "INSERT INTO messages (id,direction,from_addr,to_addr,subject,body,attachment,scenario,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        id,
        "outbound",
        "agent@coastalcatch.example",
        to,
        String(args.subject ?? "(no subject)"),
        String(args.body ?? ""),
        typeof args.attachment === "string" ? args.attachment : null,
        typeof args.scenario === "string" ? args.scenario : null,
        nowIso(),
      ],
    );
    return { ok: true, affectedRows: 1, summary: `Email delivered to ${to}`, detail: { messageId: id, to } };
  }

  if (tool === "db.delete") {
    const table = assertTable(args.table);
    const where = (args.where as Where | undefined) ?? undefined;
    const soft = args.soft === true;
    const filter = whereSql(table, where);
    if (soft && table === "orders") {
      db.run(`UPDATE orders SET archived_at = ?${filter.sql}`, [nowIso(), ...filter.params]);
    } else {
      db.run(`DELETE FROM ${table}${filter.sql}`, filter.params);
    }
    const affectedRows = db.getRowsModified();
    return {
      ok: true,
      affectedRows,
      summary: soft ? `Archived ${affectedRows} rows in ${table}` : `Deleted ${affectedRows} rows from ${table}`,
      detail: { table, soft, affectedRows },
    };
  }

  if (tool === "db.update") {
    const table = assertTable(args.table);
    const where = (args.where as Where | undefined) ?? undefined;
    const filter = whereSql(table, where);
    const set = (args.set as Where | undefined) ?? {};
    const keys = Object.keys(set);
    if (keys.length === 0) throw new Error("db.update requires a set object");
    const assignments = keys.map((k) => `${k} = ?`).join(", ");
    db.run(`UPDATE ${table} SET ${assignments}${filter.sql}`, [...keys.map((k) => toSql(set[k] as WhereValue)), ...filter.params]);
    const affectedRows = db.getRowsModified();
    return { ok: true, affectedRows, summary: `Updated ${affectedRows} rows in ${table}`, detail: { table, affectedRows } };
  }

  if (tool === "files.read") {
    const path = typeof args.path === "string" ? args.path : "";
    const file = fileRow(db, path);
    if (!file) throw new Error(`File not found: ${path}`);
    return { ok: true, affectedRows: 0, summary: `Read ${file.name}`, detail: { ...file } };
  }

  if (tool === "files.list") {
    const files = all(db, "SELECT path,name,sensitivity FROM files ORDER BY path");
    return { ok: true, affectedRows: 0, summary: `Listed ${files.length} files`, detail: { files } };
  }

  if (tool === "email.read") {
    const id = typeof args.id === "string" ? args.id : "msg-poisoned";
    const message = one(db, "SELECT * FROM messages WHERE id = ?", [id]);
    if (!message) throw new Error(`Email not found: ${id}`);
    return { ok: true, affectedRows: 0, summary: `Read inbound email "${String(message.subject)}"`, detail: message };
  }

  if (tool === "orders.read") {
    const stats = orderStats(db);
    return { ok: true, affectedRows: 0, summary: `${stats.active} active orders`, detail: stats };
  }

  if (tool === "db.drop_table") {
    throw new Error("db.drop_table is never executed");
  }

  throw new Error(`Unknown sandbox tool: ${tool}`);
}

export function orderStats(db: Database) {
  return {
    total: scalar(db, "SELECT COUNT(*) FROM orders"),
    active: scalar(db, "SELECT COUNT(*) FROM orders WHERE archived_at IS NULL"),
    archived: scalar(db, "SELECT COUNT(*) FROM orders WHERE archived_at IS NOT NULL"),
    sensitiveActive: scalar(
      db,
      `SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.archived_at IS NULL AND (c.sensitivity = 'high' OR EXISTS (
         SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.status = 'open'
       ))`,
    ),
    openShipments: scalar(db, "SELECT COUNT(*) FROM shipments WHERE status = 'open'"),
  };
}

export function proofPane(db: Database, attackerAddress = ATTACKER_ADDRESS): ProofPaneDTO {
  const total = scalar(db, "SELECT COUNT(*) FROM messages");
  const outbound = scalar(db, "SELECT COUNT(*) FROM messages WHERE direction = 'outbound'");
  const inbound = scalar(db, "SELECT COUNT(*) FROM messages WHERE direction = 'inbound'");
  const attackerMessages = scalar(db, "SELECT COUNT(*) FROM messages WHERE direction = 'outbound' AND lower(to_addr) = lower(?)", [attackerAddress]);
  const messages = all<{
    id: string;
    direction: string;
    from_addr: string;
    to_addr: string;
    subject: string;
    attachment: string | null;
    created_at: string;
  }>(db, "SELECT id,direction,from_addr,to_addr,subject,attachment,created_at FROM messages ORDER BY created_at DESC, id DESC LIMIT 30");
  const files = all<{ path: string; sensitivity: string }>(db, "SELECT path,sensitivity FROM files ORDER BY path");
  return {
    asOf: nowIso(),
    mail: {
      total,
      outbound,
      inbound,
      attackerMessages,
      attackerAddress,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction === "outbound" ? "outbound" : "inbound",
        from: m.from_addr,
        to: m.to_addr,
        subject: m.subject,
        attachment: m.attachment,
        createdAt: m.created_at,
      })),
    },
    orders: orderStats(db),
    files,
  };
}

/** Recipient/files used by the hero card, exported so tests do not drift. */
export const HERO = {
  attacker: ATTACKER_ADDRESS,
  internalOwner: INTERNAL_OWNER,
  contract: HERO_CONTRACT,
};
