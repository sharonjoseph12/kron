import { describe, it, expect, vi } from "vitest";
import { KronClient, KronError } from "./client.js";

describe("KronClient", () => {
  it("initializes with configuration and normalizes URL", () => {
    const client = new KronClient({ apiUrl: "http://localhost:8787///" });
    expect(client).toBeDefined();
  });

  it("handles login flow and stores session cookie", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "set-cookie": "kron.sid=abc12345; Path=/; HttpOnly" }),
      text: async () => JSON.stringify({ user: { id: "u1", email: "admin@kron.dev", role: "admin" } }),
    });

    const client = new KronClient({
      apiUrl: "http://localhost:8787",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const res = await client.login("admin@kron.dev", "admin1234");
    expect(res.user.email).toBe("admin@kron.dev");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8787/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "admin@kron.dev", password: "admin1234" }),
      }),
    );
  });

  it("attaches session cookie to subsequent requests", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "set-cookie": "kron.sid=session_tok_99; Path=/" }),
          text: async () => JSON.stringify({ user: { id: "u1", email: "a@k.dev", role: "admin" } }),
        };
      }
      // Second call should have cookie header
      const headers = init?.headers as Headers;
      expect(headers.get("cookie")).toBe("kron.sid=session_tok_99");
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ agents: [{ id: "ag1", name: "researcher" }] }),
      };
    });

    const client = new KronClient({
      apiUrl: "http://localhost:8787",
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.login("a@k.dev", "pw");
    const agents = await client.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("researcher");
  });

  it("throws KronError on API error with status and message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      text: async () => JSON.stringify({ error: "Policy blocked: budget exceeded" }),
    });

    const client = new KronClient({
      apiUrl: "http://localhost:8787",
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.getAgent("ag_invalid")).rejects.toThrow(KronError);
    await expect(client.getAgent("ag_invalid")).rejects.toThrow("Policy blocked: budget exceeded");
  });

  it("sends the API key as an Authorization bearer header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ agents: [{ id: "ag1", name: "llm-agent" }] }),
    });

    const client = new KronClient({
      apiUrl: "http://localhost:8787",
      apiKey: "kron_testkey123",
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.listAgents();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer kron_testkey123");
  });

  it("rejects login() when configured with an API key", async () => {
    const client = new KronClient({ apiUrl: "http://localhost:8787", apiKey: "kron_test" });
    await expect(client.login("a@b.c", "pw")).rejects.toThrow(/API key/);
  });

  it("submits A2A hire request with correct parameters", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () =>
        JSON.stringify({
          ok: true,
          status: "AUTO_APPROVED",
          hiredAgent: { id: "trader-01", name: "Trader" },
          taskResult: "[Agent: Trader] Completed subtask.",
        }),
    });

    const client = new KronClient({
      apiUrl: "http://localhost:8787",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const res = await client.hireAgent({
      agentId: "researcher-01",
      targetAgentId: "trader-01",
      task: "Analyze sentiment",
      amountAlgo: 0.035,
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("AUTO_APPROVED");
    expect(res.hiredAgent?.name).toBe("Trader");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8787/api/agents/researcher-01/hire",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          targetAgentId: "trader-01",
          task: "Analyze sentiment",
          amountAlgo: 0.035,
        }),
      }),
    );
  });
});
