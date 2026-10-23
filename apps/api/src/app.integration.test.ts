/**
 * KRON API integration tests — exercise the real Fastify app via inject()
 * against an isolated SQLite database seeded with the admin + demo agents.
 *
 * The Algorand client is mocked so no route ever touches the chain: the
 * suite only exercises policy-only, DB-backed routes (healthz, auth, agents,
 * policy, evaluate, sessions, payment verification 404).
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/algorand/client.js", () => {
  const notFound = async () => null;
  return {
    AlgorandClient: class {},
    algorand: {
      network: "testnet",
      algodUrl: "http://127.0.0.1:59998",
      algodToken: "",
      indexerUrl: "http://127.0.0.1:59997",
      indexerToken: "",
      getChainParams: vi.fn(async () => ({
        fee: 1000,
        minFee: 1000,
        firstValid: 1,
        lastValid: 1001,
        genesisID: "testnet-v1.0",
        genesisHash: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
      })),
      getTransaction: vi.fn(notFound),
      getIndexedTransaction: vi.fn(notFound),
      getRecentTransactions: vi.fn(async () => []),
      getBalanceAlgo: vi.fn(async () => 0),
      getAccount: vi.fn(async () => ({ address: "", balanceAlgo: 0, pendingRewardsAlgo: 0, rewardBaseAlgo: 0, round: 0 })),
      submitRawTransaction: vi.fn(async () => ({ txId: "test-tx" })),
      waitForConfirmation: vi.fn(async () => ({ txId: "test-tx", confirmedRound: 1, confirmedAt: new Date().toISOString() })),
      sendPayment: vi.fn(async () => ({ txId: "test-tx", confirmedRound: 1, sender: "", signedTxnB64: "AA==" })),
    },
  };
});

import { buildServer } from "./server.js";

const ADMIN_EMAIL = "admin@kron.dev";
const ADMIN_PASSWORD = "admin1234";

interface SessionCookie {
  cookies?: Array<{ name: string; value: string }>;
}

let app: FastifyInstance;
let adminCookie = "";
let agentId = "";
let agentWalletAddress = "";

function extractSessionCookie(res: SessionCookie): string {
  const sid = res.cookies?.find((c) => c.name === "kron.sid");
  if (!sid) throw new Error("no kron.sid cookie returned by login");
  return `kron.sid=${sid.value}`;
}

describe("KRON API integration", () => {
  beforeAll(async () => {
    app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    adminCookie = extractSessionCookie(res);
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /healthz reports a healthy stack", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("kron-api");
    expect(body.database).toBe("ok");
  });

  it("POST /api/auth/login authenticates the seeded admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.email).toBe(ADMIN_EMAIL);
    expect(user.role).toBe("admin");
    expect(user.id).toBeTruthy();
  });

  it("POST /api/auth/demo is disabled unless DEMO_MODE is enabled", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/demo" });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/auth/demo opens a sandbox operator session when enabled", async () => {
    const { config } = await import("./config.js");
    const previous = config.demoMode;
    config.demoMode = true;
    try {
      const res = await app.inject({ method: "POST", url: "/api/auth/demo" });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe(ADMIN_EMAIL);
      const cookie = extractSessionCookie(res);
      const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.email).toBe(ADMIN_EMAIL);
    } finally {
      config.demoMode = previous;
    }
  });

  it("rejects unauthenticated access to /api/agents with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the seeded agents when authenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const { agents } = res.json();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThanOrEqual(2);
    expect(agents.some((a: { name: string }) => a.name === "researcher-01")).toBe(true);
    expect(agents.some((a: { name: string }) => a.name === "trader-01")).toBe(true);
  });

  it("POST /api/agents creates an agent with a dedicated wallet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { cookie: adminCookie },
      payload: { name: "integration-agent", description: "Created by the integration suite" },
    });
    expect(res.statusCode).toBe(200);
    const { agent } = res.json();
    expect(agent.name).toBe("integration-agent");
    expect(agent.status).toBe("idle");
    expect(agent.walletAddress).toBeTruthy();
    expect(agent.activePolicyVersion).toBeGreaterThanOrEqual(1);
    agentId = agent.id;
    agentWalletAddress = agent.walletAddress;
  });

  it("PUT /api/agents/:id/policy publishes a policy and GET returns it", async () => {
    const put = await app.inject({
      method: "PUT",
      url: `/api/agents/${agentId}/policy`,
      headers: { cookie: adminCookie },
      payload: {
        name: "integration-policy",
        perCallLimitAlgo: 0.05,
        hardCeilingAlgo: 1.0,
        sessionBudgetAlgo: 0.5,
        dailyBudgetAlgo: 1.0,
        maxDailyPayments: 10,
        unknownRecipient: "allow",
        firstTimeService: "allow",
        serviceAllowlist: ["market"],
      },
    });
    expect(put.statusCode).toBe(200);
    const { policy } = put.json();
    expect(policy.name).toBe("integration-policy");
    expect(policy.version).toBeGreaterThanOrEqual(2);
    expect(policy.perCallLimitAlgo).toBeCloseTo(0.05, 6);
    expect(policy.active).toBe(true);

    const get = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/policy`,
      headers: { cookie: adminCookie },
    });
    expect(get.statusCode).toBe(200);
    const got = get.json().policy;
    expect(got.version).toBe(policy.version);
    expect(got.serviceAllowlist).toContain("market");
    expect(got.unknownRecipient).toBe("allow");
  });

  it("POST /api/agents/:id/evaluate dry-runs a payment evaluation", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/evaluate`,
      headers: { cookie: adminCookie },
      payload: { recipient: agentWalletAddress, amountAlgo: 0.01, service: "market" },
    });
    expect(res.statusCode).toBe(200);
    const { evaluation } = res.json();
    expect(evaluation.decision).toBe("AUTO_APPROVED");
    expect(evaluation.requestedAlgo).toBeCloseTo(0.01, 6);
    expect(evaluation.policyVersion).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(evaluation.reasons)).toBe(true);
  });

  it("POST /api/agents/:id/sessions starts a session and GET lists it", async () => {
    const start = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/sessions`,
      headers: { cookie: adminCookie },
      payload: { task: "integration session task" },
    });
    expect(start.statusCode).toBe(200);
    const { session } = start.json();
    expect(session.agentId).toBe(agentId);
    expect(session.task).toBe("integration session task");
    expect(session.status).toBe("running");

    const list = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/sessions`,
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    const sessions = list.json().sessions;
    expect(sessions.some((s: { id: string }) => s.id === session.id)).toBe(true);
  });

  it("GET /api/payments/verify/<unknown> returns 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/payments/verify/does-not-exist",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("KRON API security hardening", () => {
  let secApp: FastifyInstance;
  const seededIds: string[] = [];

  /** Seed agent→session→policy→payment→decision→escalation and return ids. */
  async function seedEscalation(opts: { expired: boolean }) {
    const { prisma } = await import("./db.js");
    const agent = await prisma.agent.create({
      data: { name: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, description: "security suite", status: "idle" },
    });
    const sessionRow = await prisma.agentSession.create({ data: { agentId: agent.id, status: "running" } });
    const policy = await prisma.policy.create({ data: { id: agent.id, agentId: agent.id } });
    const pv = await prisma.policyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        name: "sec-policy",
        perCallLimitMicro: 50_000n,
        hardCeilingMicro: 1_000_000n,
        sessionBudgetMicro: 500_000n,
        dailyBudgetMicro: 5_000_000n,
        maxDailyPayments: 10,
        unknownRecipient: "allow",
        firstTimeService: "allow",
        recipientAllowlist: [],
        recipientBlocklist: [],
        serviceAllowlist: [],
        serviceBlocklist: [],
        active: true,
      },
    });
    const payment = await prisma.paymentRequest.create({
      data: {
        clientRequestId: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        agentId: agent.id,
        sessionId: sessionRow.id,
        toolCallId: "tc-sec",
        service: "market",
        resourceId: "res-sec",
        resourceName: "Security Test Resource",
        recipient: "RRZ5UEO2XGYIGEYSKXWQJJ4LJSBBXNXC6TAGD4U3FBN4TXO3Q6JZ2VQTOI",
        amountMicro: 10_000n,
        network: "testnet",
        status: "escalated",
      },
    });
    const decision = await prisma.paymentDecision.create({
      data: {
        paymentId: payment.id,
        decision: "ESCALATED",
        reasons: ["over per-call limit"],
        rulesTriggered: [],
        policyVersionId: pv.id,
        policyVersionNumber: pv.version,
      },
    });
    const esc = await prisma.escalation.create({
      data: {
        paymentId: payment.id,
        decisionId: decision.id,
        summary: "security suite escalation",
        status: "pending",
        expiresAt: opts.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 15 * 60_000),
      },
    });
    seededIds.push(agent.id, sessionRow.id, policy.id, pv.id, payment.id, decision.id, esc.id);
    return { agent, sessionRow, payment, esc };
  }

  async function cleanupSeed(): Promise<void> {
    const { prisma } = await import("./db.js");
    for (const id of seededIds.splice(0)) {
      await prisma.escalation.deleteMany({ where: { OR: [{ id }, { paymentId: id }] } }).catch(() => {});
      await prisma.paymentDecision.deleteMany({ where: { OR: [{ id }, { paymentId: id }] } }).catch(() => {});
      await prisma.settlement.deleteMany({ where: { paymentId: id } }).catch(() => {});
      await prisma.paymentRequest.deleteMany({ where: { id } }).catch(() => {});
      await prisma.policyVersion.deleteMany({ where: { id } }).catch(() => {});
      await prisma.policy.deleteMany({ where: { id } }).catch(() => {});
      await prisma.agentSession.deleteMany({ where: { id } }).catch(() => {});
      await prisma.alert.deleteMany({ where: { agentId: id } }).catch(() => {});
      await prisma.toolCall.deleteMany({ where: { sessionId: id } }).catch(() => {});
      await prisma.timelineEvent.deleteMany({ where: { sessionId: id } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { id } }).catch(() => {});
    }
  }

  beforeAll(async () => {
    secApp = await buildServer();
    const res = await secApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    adminCookie = extractSessionCookie(res);
  });

  afterAll(async () => {
    await cleanupSeed();
    if (secApp && secApp !== app) await secApp.close();
  });

  it("GET /api/analytics/overview requires authentication", async () => {
    const anon = await secApp.inject({ method: "GET", url: "/api/analytics/overview" });
    expect(anon.statusCode).toBe(401);
    const authed = await secApp.inject({
      method: "GET",
      url: "/api/analytics/overview",
      headers: { cookie: adminCookie },
    });
    expect(authed.statusCode).toBe(200);
  });

  it("GET /api/events rejects anonymous access; ?token= authenticates", async () => {
    const anon = await secApp.inject({ method: "GET", url: "/api/events" });
    expect(anon.statusCode).toBe(401);

    // EventSource cannot send headers — the query token must authenticate.
    // (A full SSE inject would hang: the hijacked stream never ends.)
    const login = await secApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const sid = login.cookies?.find((c) => c.name === "kron.sid")!.value;
    const { getSessionUser } = await import("./lib/auth.js");
    const user = await getSessionUser({
      headers: {},
      query: { token: sid },
      cookies: {},
    } as unknown as Parameters<typeof getSessionUser>[0]);
    expect(user?.email).toBe(ADMIN_EMAIL);
  });

  it("non-admin roles cannot decide escalations", async () => {
    const { prisma } = await import("./db.js");
    const { createSession } = await import("./lib/auth.js");
    const { esc } = await seedEscalation({ expired: false });
    const operator = await prisma.user.create({
      data: { email: `op-${Date.now()}@kron.test`, passwordHash: "x", role: "operator" },
    });
    const session = await createSession(operator.id);
    const res = await secApp.inject({
      method: "POST",
      url: `/api/escalations/${esc.id}/decide`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { approve: true },
    });
    expect(res.statusCode).toBe(403);
    await prisma.user.delete({ where: { id: operator.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: operator.id } }).catch(() => {});
  });

  it("expired escalations return 409 and are marked expired", async () => {
    const { prisma } = await import("./db.js");
    const { payment, esc } = await seedEscalation({ expired: true });

    const res = await secApp.inject({
      method: "POST",
      url: `/api/escalations/${esc.id}/decide`,
      headers: { cookie: adminCookie },
      payload: { approve: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("escalation_expired");

    const after = await prisma.escalation.findUnique({ where: { id: esc.id } });
    expect(after?.status).toBe("expired");
    const untouched = await prisma.paymentRequest.findUnique({ where: { id: payment.id } });
    expect(untouched?.status).toBe("escalated");
  });
});
