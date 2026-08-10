import type { ChatMessage, CompletionFn, CompletionResult } from "../types.js";

export interface LiteLLMOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * completionFn bound to a LiteLLM proxy's OpenAI-compatible chat completions
 * API. LiteLLM itself isn't a model provider — it's a unified proxy in front
 * of whichever provider(s) it's configured with — so this just needs a base
 * URL, same request/response shape as OpenRouter/OpenAI.
 */
export function createLiteLLMCompletionFn({ baseUrl, apiKey, model }: LiteLLMOptions): CompletionFn {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return async function completionFn(
    messages: ChatMessage[],
    opts: { signal?: AbortSignal } = {}
  ): Promise<CompletionResult> {
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`LiteLLM API error ${res.status}: ${errText}`);
    }

    const json = (await res.json()) as ChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    return { content: text };
  };
}
