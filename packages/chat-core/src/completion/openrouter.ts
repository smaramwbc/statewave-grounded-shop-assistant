import type { ChatMessage, CompletionFn, CompletionResult } from "../types.js";

const API_BASE = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  referer?: string;
  title?: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * completionFn bound to OpenRouter's OpenAI-compatible chat completions API.
 * Framework-agnostic by design — chat-core doesn't know or care which model
 * answers, only that completionFn returns { content: string }.
 */
export function createOpenRouterCompletionFn({
  apiKey,
  model = "openai/gpt-4o-mini",
  referer,
  title,
}: OpenRouterOptions): CompletionFn {
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

    const res = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(referer ? { "HTTP-Referer": referer } : {}),
        ...(title ? { "X-Title": title } : {}),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
    }

    const json = (await res.json()) as ChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    return { content: text };
  };
}
