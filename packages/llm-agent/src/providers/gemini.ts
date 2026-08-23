import type {
  AssistantMessage,
  CompleteParams,
  LLMProvider,
  LLMProviderConfig,
  ToolCall,
  TranscriptMessage,
} from "../types.js";

export interface GeminiConfig extends LLMProviderConfig {
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

/**
 * Google Gemini adapter for the KRON agent runtime.
 * Uses the generateContent API over plain fetch.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) throw new Error("GeminiProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.model = config.model || "gemini-2.5-flash";
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async complete(params: CompleteParams): Promise<AssistantMessage> {
    const contents = params.transcript.map(convertMessage);
    
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: params.system }] },
      contents,
    };

    if (params.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
    }

    const res = await fetch(`${this.baseUrl}/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as any;
    const firstCandidate = data.candidates?.[0];
    const parts = firstCandidate?.content?.parts ?? [];

    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.name + "_" + Math.random().toString(36).slice(2, 9),
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        });
      }
    }

    return { content, toolCalls };
  }
}

function convertMessage(msg: TranscriptMessage) {
  if (msg.role === "tool") {
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: msg.name || "tool_call",
            response: { result: msg.content },
          },
        },
      ],
    };
  }

  const role = msg.role === "assistant" ? "model" : "user";
  const parts: Record<string, unknown>[] = [];

  if (msg.role === "assistant" && "toolCalls" in msg && msg.toolCalls.length > 0) {
    if (msg.content) parts.push({ text: msg.content });
    for (const tc of msg.toolCalls) {
      parts.push({
        functionCall: {
          name: tc.name,
          args: tc.arguments,
        },
      });
    }
  } else {
    parts.push({ text: msg.content });
  }

  return { role, parts };
}
