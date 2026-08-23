/**
 * Provider-agnostic types for the KRON LLM agent runtime.
 * The runtime is transport-agnostic: it only requires an {@link LLMProvider}
 * implementation and a set of {@link ToolDefinition}s.
 */

export type ChatRole = "user" | "assistant" | "system";

/** A plain-text conversation message. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** A tool exposed to the model. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (same shape as MCP inputSchema). */
  inputSchema: Record<string, unknown>;
  /** Execute the tool; returns a text render of the result. */
  execute(args: Record<string, unknown>): Promise<string>;
}

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Gemini 3.x thought_signature required when thinking is enabled. */
  thoughtSignature?: string;
}

/** The model's reply: free-text plus any tool calls it wants executed. */
export interface AssistantMessage {
  /** Text portion of the reply (may be empty when tool calls are requested). */
  content: string;
  toolCalls: ToolCall[];
  /** Thinking trace for Gemini 3.x — echoed back verbatim when present. */
  thought?: string;
}

/**
 * A transcript entry. Providers convert this into their native wire format,
 * so the loop never leaks provider-specific framing.
 */
export type TranscriptMessage =
  | { role: "user" | "assistant" | "system"; content: string; thought?: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[]; thought?: string }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** One step of the agent loop, surfaced via `onStep`. */
export interface AgentStep {
  iteration: number;
  assistant: AssistantMessage;
  toolResults: ToolResultMessage[];
}

export interface ToolResultMessage {
  toolCallId: string;
  name: string;
  content: string;
}

export interface AgentRunResult {
  /** Final answer from the model (no further tool calls requested). */
  finalText: string;
  iterations: number;
  steps: AgentStep[];
}

export interface AgentLoopOptions {
  provider: LLMProvider;
  system: string;
  tools: ToolDefinition[];
  /** The initial user prompt that starts the task. */
  prompt: string;
  /** Hard cap on loop iterations (default 12). */
  maxIterations?: number;
  /** Called after each model response (for streaming/narration). */
  onStep?: (step: AgentStep) => void;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: "anthropic" | "openai" | "gemini";
  readonly model: string;
  complete(params: CompleteParams): Promise<AssistantMessage>;
}

export interface CompleteParams {
  system: string;
  tools: ToolDefinition[];
  transcript: TranscriptMessage[];
  signal?: AbortSignal;
}

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export class AgentLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentLoopError";
  }
}