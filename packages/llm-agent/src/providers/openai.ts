import type {
  AssistantMessage,
  CompleteParams,
  LLMProvider,
  LLMProviderConfig,
  ToolCall,
  TranscriptMessage,
} from "../types.js";

export interface OpenAIConfig extends LLMProviderConfig {
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com";

/**
 * OpenAI GPT adapter for the KRON agent runtime.
 * Uses the Responses API over plain fetch (no SDK dependency) with native
 * tool-calling, and converts the shared {@link TranscriptMessage} format to
 * the wire format.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokens?: number;
  private readonly temperature?: number;

  constructor(config: OpenAIConfig) {
    if (!config.apiKey) throw new Error("OpenAIProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.model = config.model || "gpt-4o";
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
  }

  async complete(params: CompleteParams): Promise<AssistantMessage> {
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: params.system,
      input: params.transcript.map(convertMessage),
      tools: params.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    };
    if (this.maxTokens !== undefined) body.max_output_tokens = this.maxTokens;
    if (this.temperature !== undefined) body.temperature = this.temperature;

    const res = await fetch(`${this.baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      output?: Array<{
        type?: string;
        name?: string;
        call_id?: string;
        arguments?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };

    let content = "";
    const toolCalls: ToolCall[] = [];
    for (const item of data.output ?? []) {
      if (item.type === "message") {
        for (const part of item.content ?? []) {
          if (part.type === "output_text" && typeof part.text === "string") {
            content += part.text;
          }
        }
      } else if (item.type === "function_call" && item.call_id && item.name) {
        toolCalls.push({
          id: item.call_id,
          name: item.name,
          arguments: parseArguments(item.arguments),
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
        { type: "function_call_output" as const, call_id: msg.toolCallId, output: msg.content },
      ],
    };
  }
  if (msg.role === "assistant" && "toolCalls" in msg && msg.toolCalls.length > 0) {
    const parts: Record<string, unknown>[] = [];
    if (msg.content) parts.push({ type: "output_text", text: msg.content });
    for (const tc of msg.toolCalls) {
      parts.push({
        type: "function_call",
        call_id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      });
    }
    return { role: "assistant" as const, content: parts };
  }
  return {
    role: msg.role,
    content: msg.role === "assistant" ? [{ type: "output_text", text: msg.content }] : [{ type: "input_text", text: msg.content }],
  };
}

function parseArguments(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { _raw: raw };
  }
}