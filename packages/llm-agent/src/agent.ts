import {
  AgentLoopError,
  type AgentLoopOptions,
  type AgentRunResult,
  type AgentStep,
  type ToolResultMessage,
} from "./types.js";

/**
 * Run the agentic tool-use loop:
 *
 *   1. Ask the provider for a response (tools enabled).
 *   2. If the model returns tool calls, execute them and feed the results back.
 *   3. Repeat until the model produces a final answer (no tool calls) or the
 *      iteration cap is hit.
 *
 * Payment-required tool results are surfaced to the model as plain text, so a
 * model that hits an x402 paywall can re-route through `kron.call_tool` where
 * KRON settles the payment automatically.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentRunResult> {
  const { provider, system, tools, prompt, maxIterations = 12, onStep, signal } = opts;

  const transcript: TranscriptMessageLike[] = [{ role: "user", content: prompt }];
  const steps: AgentStep[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const assistant = await provider.complete({ system, tools, transcript, signal });
    if (signal?.aborted) throw new AgentLoopError("Agent loop aborted");

    const toolResults: ToolResultMessage[] = [];
    if (assistant.toolCalls.length === 0) {
      return { finalText: assistant.content, iterations: iteration + 1, steps };
    }

    transcript.push({ role: "assistant", content: assistant.content, toolCalls: assistant.toolCalls, thought: assistant.thought } as any);
    for (const call of assistant.toolCalls) {
      const tool = tools.find((t) => t.name === call.name);
      let content: string;
      if (!tool) {
        content = `Unknown tool: ${call.name}. Available tools: ${tools.map((t) => t.name).join(", ")}`;
      } else {
        try {
          content = await tool.execute(call.arguments);
        } catch (err) {
          content = `Tool ${call.name} failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      toolResults.push({ toolCallId: call.id, name: call.name, content });
      transcript.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    }

    const step: AgentStep = { iteration, assistant, toolResults };
    steps.push(step);
    onStep?.(step);
  }

  throw new AgentLoopError(`Agent exceeded the iteration cap (${maxIterations})`);
}

type TranscriptMessageLike =
  | { role: "user" | "assistant" | "system"; content: string; thought?: string }
  | { role: "assistant"; content: string; thought?: string; toolCalls: { id: string; name: string; arguments: Record<string, unknown>; thoughtSignature?: string }[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };