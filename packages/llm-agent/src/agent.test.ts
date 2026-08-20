import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "./agent.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import type { LLMProvider, ToolDefinition } from "./types.js";

const echoTool: ToolDefinition = {
  name: "echo",
  description: "echo",
  inputSchema: { type: "object" },
  execute: async (args) => JSON.stringify(args),
};

function makeFakeProvider(
  script: Array<{ content: string; toolCalls: Array<{ name: string }> }>,
): LLMProvider {
  let i = 0;
  return {
    name: "anthropic",
    model: "fake",
    complete: async () => {
      const step = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return {
        content: step.content,
        toolCalls: step.toolCalls.map((tc, j) => ({ id: `call_${j}`, name: tc.name, arguments: {} })),
      };
    },
  };
}

describe("runAgentLoop", () => {
  it("executes tool calls and returns the final answer", async () => {
    const provider = makeFakeProvider([
      { content: "let me check", toolCalls: [{ name: "echo" }] },
      { content: "the answer is 42", toolCalls: [] },
    ]);
    const result = await runAgentLoop({ provider, system: "sys", tools: [echoTool], prompt: "question" });
    expect(result.finalText).toBe("the answer is 42");
    expect(result.iterations).toBe(2);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.assistant.toolCalls).toHaveLength(1);
    expect(result.steps[0]!.toolResults[0]!.content).toBe("{}");
  });

  it("throws when the iteration cap is exceeded", async () => {
    const provider = makeFakeProvider([{ content: "", toolCalls: [{ name: "echo" }] }]);
    await expect(
      runAgentLoop({ provider, system: "sys", tools: [echoTool], prompt: "q", maxIterations: 3 }),
    ).rejects.toThrow(/iteration cap/);
  });

  it("surfaces unknown-tool errors to the model", async () => {
    const provider = makeFakeProvider([
      { content: "", toolCalls: [{ name: "nope" }] },
      { content: "done", toolCalls: [] },
    ]);
    const result = await runAgentLoop({ provider, system: "s", tools: [echoTool], prompt: "q" });
    expect(result.steps[0]!.toolResults[0]!.content).toMatch(/Unknown tool: nope/);
  });
});

describe("AnthropicProvider", () => {
  it("builds the correct wire format and parses tool_use", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              { type: "text", text: "sure" },
              { type: "tool_use", id: "tu_1", name: "echo", input: { a: 1 } },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider({ apiKey: "sk-test", model: "claude-x" });
    const res = await provider.complete({
      system: "sys",
      tools: [echoTool],
      transcript: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "", toolCalls: [{ id: "tu_1", name: "echo", arguments: { a: 1 } }] },
        { role: "tool", toolCallId: "tu_1", name: "echo", content: "ok" },
      ],
    });
    expect(res.content).toBe("sure");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.name).toBe("echo");
    expect(res.toolCalls[0]!.arguments).toEqual({ a: 1 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ role: string; content: unknown[] }>;
    };
    expect(body.messages[0].role).toBe("user");
    const assistantContent = body.messages[1]!.content as Array<{ type: string }>;
    expect(assistantContent.some((b) => b.type === "tool_use")).toBe(true);
    expect((body.messages[2]!.content[0] as { type: string }).type).toBe("tool_result");
    vi.unstubAllGlobals();
  });

  it("throws a readable error on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const provider = new AnthropicProvider({ apiKey: "sk", model: "c" });
    await expect(provider.complete({ system: "", tools: [], transcript: [] })).rejects.toThrow(/401/);
    vi.unstubAllGlobals();
  });
});

describe("OpenAIProvider", () => {
  it("builds the correct Responses API wire format and parses function calls", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              { type: "message", role: "assistant", content: [{ type: "output_text", text: "sure" }] },
              { type: "function_call", call_id: "fc_1", name: "echo", arguments: '{"a":1}' },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider({ apiKey: "sk-test", model: "gpt-4o" });
    const res = await provider.complete({
      system: "sys",
      tools: [echoTool],
      transcript: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "", toolCalls: [{ id: "fc_1", name: "echo", arguments: { a: 1 } }] },
        { role: "tool", toolCallId: "fc_1", name: "echo", content: "ok" },
      ],
    });
    expect(res.content).toBe("sure");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.arguments).toEqual({ a: 1 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      input: Array<{ role: string; content: unknown[] }>;
    };
    const assistantMsg = body.input.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const assistantContent = assistantMsg!.content as Array<{ type: string }>;
    expect(assistantContent.some((b) => b.type === "function_call")).toBe(true);

    const toolMsg = body.input.find((m) => m.content.some((c: any) => c.type === "function_call_output"));
    expect(toolMsg).toBeDefined();
    vi.unstubAllGlobals();
  });


  it("throws a readable error on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
    const provider = new OpenAIProvider({ apiKey: "sk", model: "gpt" });
    await expect(provider.complete({ system: "", tools: [], transcript: [] })).rejects.toThrow(/429/);
    vi.unstubAllGlobals();
  });
});