import type {
  AssistantMessage,
  CompleteParams,
  LLMProvider,
  LLMProviderConfig,
  ToolCall,
  TranscriptMessage,
} from "../types.js";

const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicConfig extends LLMProviderConfig {
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com";

/**
 * Anthropic Claude adapter for the KRON agent runtime.
 * Talks to the Messages API over plain fetch (no SDK dependency) and
 * converts the shared {@link TranscriptMessage} format to the wire format.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly temperature?: number;

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) throw new Error("AnthropicProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.model = config.model || "claude-sonnet-4-5-20250929";
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxTokens = config.maxTokens ?? 1024;
    this.temperature = config.temperature;
  }

  async complete(params: CompleteParams): Promise<AssistantMessage> {
    const body: Record<string, unknown> = {
      model: this.model,
      system: params.system,
      max_tokens: this.maxTokens,
      messages: params.transcript.map(convertMessage),
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    };
    if (this.temperature !== undefined) body.temperature = this.temperature;

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Anthropic API error ${res.status}: ${text.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as {
      content?: Array<{
        type?: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }>;
    };

    let content = "";
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        content += block.text;
      } else if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: parseInput(block.input),
        });
      }
    }
    return { content, toolCalls };
  }
}

function convertMessage(msg: TranscriptMessage) {
  if (msg.role === "tool") {
    return {
      role: "user" as const,
      content: [
        { type: "tool_result" as const, tool_use_id: msg.toolCallId, content: msg.content },
      ],
    };
  }
  if (msg.role === "assistant" && "toolCalls" in msg && msg.toolCalls.length > 0) {
    const blocks: Record<string, unknown>[] = [];
    if (msg.content) blocks.push({ type: "text", text: msg.content });
    for (const tc of msg.toolCalls) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
    }
    return { role: "assistant" as const, content: blocks };
  }
  return { role: msg.role, content: msg.content };
}

function parseInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") return input as Record<string, unknown>;
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch {
      return { _raw: input };
    }
  }
  return {};
}