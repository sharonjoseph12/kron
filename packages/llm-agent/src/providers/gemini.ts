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
  /** Ordered fallback models to try when the primary hits 429/RPD quota. */
  fallbackModels?: string[];
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
  private readonly fallbackModels: string[];

  constructor(config: GeminiConfig) {
    if (!config.apiKey) throw new Error("GeminiProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.model = config.model || "gemini-2.5-flash";
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fallbackModels = (config.fallbackModels ?? []).filter((m) => !!m && m !== this.model);
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

    // Build ordered chain: primary then fallbacks. Uses separate RPM/RPD buckets per model.
    const modelsToTry = [this.model, ...this.fallbackModels].filter(Boolean);
    let lastErrorText = "";
    let lastStatus = 0;
    let res: Response | null = null;
    let activeModel = modelsToTry[0]!;

    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      activeModel = modelsToTry[mIdx]!;
      const isLastModel = mIdx === modelsToTry.length - 1;
      // Only the last model in the chain gets full exponential retries; fallback models fail-fast to next
      const maxRetries = isLastModel ? 3 : 1;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        res = await fetch(`${this.baseUrl}/v1beta/models/${activeModel}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: params.signal,
        });

        if (res.ok) break;

        lastStatus = res.status;
        lastErrorText = await res.text().catch(() => "");

        const isRetryable = res.status === 429 || res.status >= 500;
        // For non-last models: any error (429 quota, 404 model not found, etc) -> fail-fast to next fallback
        // Don't waste time retrying a model that is quota-exhausted or deprecated when we have alternatives
        if (!res.ok && !isLastModel) {
          if (res.status === 429) {
            console.warn(`   [gemini] ${activeModel} quota hit (RPM/RPD ${res.status}) — falling back to ${modelsToTry[mIdx + 1]}...`);
          } else {
            console.warn(`   [gemini] ${activeModel} error ${res.status} — falling back to ${modelsToTry[mIdx + 1]}...`);
          }
          break; // outer loop tries next model
        }
        if (!isRetryable || (isLastModel && attempt === maxRetries)) {
          throw new Error(`Gemini API error ${res.status} (model ${activeModel}): ${lastErrorText.slice(0, 500)}`);
        }
        // Last model but not yet exhausted retries -> backoff then retry same model
        if (isRetryable && attempt < maxRetries) {
          let delayMs = 0;
          const retryAfterHeader = res.headers.get("retry-after");
          if (retryAfterHeader) {
            const secs = Number(retryAfterHeader);
            if (Number.isFinite(secs)) delayMs = secs * 1000;
          }
          if (!delayMs) {
            const match = lastErrorText.match(/retry in (\d+(?:\.\d+)?)s/i);
            if (match) delayMs = Math.ceil(Number(match[1]) * 1000);
          }
          if (!delayMs) delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          delayMs = Math.min(delayMs, 60_000);
          console.warn(`   [gemini] 429/quota hit — retry ${attempt + 1}/${maxRetries} in ${(delayMs / 1000).toFixed(1)}s...`);
          await new Promise<void>((r, reject) => {
            const t = setTimeout(r, delayMs);
            params.signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Aborted")); }, { once: true });
          });
          continue;
        }
        break;
      }
      if (res?.ok) break;
      // if not ok and not last model, outer loop will try next model; last model already threw above
    }

    if (!res || !res.ok) {
      throw new Error(`Gemini API error ${lastStatus} (model ${activeModel}): ${lastErrorText.slice(0, 500)}`);
    }
    if (activeModel !== this.model) {
      console.log(`   [gemini] served by fallback model ${activeModel} (primary ${this.model} exhausted)`);
    }

    const data = (await res.json()) as any;
    const firstCandidate = data.candidates?.[0];
    const parts = firstCandidate?.content?.parts ?? [];

    let content = "";
    let thought: string | undefined;
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text !== undefined) {
        // Preserve thinking traces separately — they must be echoed with thought:true
        if (part.thought === true) {
          thought = (thought ?? "") + part.text;
        } else {
          content += part.text;
        }
      } else if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.id ?? part.functionCall.name + "_" + Math.random().toString(36).slice(2, 9),
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
          thoughtSignature: part.thoughtSignature ?? part.functionCall.thought_signature ?? part.thought_signature ?? part.functionCall.thoughtSignature,
        });
      }
    }

    return { content, toolCalls, thought } as AssistantMessage;
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
    const am = msg as AssistantMessage;
    if (am.thought) parts.push({ text: am.thought, thought: true });
    if (msg.content) parts.push({ text: msg.content });
    for (const tc of msg.toolCalls) {
      const fc: Record<string, unknown> = {
        name: tc.name,
        args: tc.arguments,
      };
      // Gemini 3.x: thoughtSignature is a top-level part field, not inside functionCall (API uses camelCase)
      const part: Record<string, unknown> = { functionCall: fc };
      if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
      parts.push(part);
    }
  } else {
    const am = msg as AssistantMessage;
    if ((am as any).thought) parts.push({ text: (am as any).thought, thought: true });
    parts.push({ text: msg.content });
  }

  return { role, parts };
}
