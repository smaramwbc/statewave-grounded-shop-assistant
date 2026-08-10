import type { ChatMessage, CompletionFn, CompletionResult } from "../types.js";

/**
 * Zero-dependency fallback completionFn used when no OPENROUTER_API_KEY is set,
 * so the whole use case is runnable and demonstrable with no secrets at all.
 * It's rule-based, not a language model: it composes an answer directly out
 * of the retrieved evidence and cites everything it uses.
 */
export function createOfflineCompletionFn(): CompletionFn {
  return async function completionFn(messages: ChatMessage[]): Promise<CompletionResult> {
    const evidenceMsg = messages.find((m) => m.content?.startsWith("<evidence>"));
    const ids = [...(evidenceMsg?.content.matchAll(/\[(S\d+)\]/g) ?? [])].map((m) => m[1]);

    if (!evidenceMsg || ids.length === 0) {
      return {
        content: JSON.stringify({
          answer: "I couldn't find anything on that in our knowledge base.",
          grounded: false,
          citationIds: [],
        }),
      };
    }

    const lines = evidenceMsg.content
      .split("\n")
      .filter((l) => /^\[S\d+\]/.test(l))
      .slice(0, 3);
    const usedIds = lines.map((l) => l.match(/^\[(S\d+)\]/)![1]);
    const facts = lines.map((l) => l.replace(/^\[S\d+\]\s*\([^)]+\)\s*/, "").trim());

    const full = `Based on what I found: ${facts.join(" ")}`;
    const answer =
      full.length <= 600 ? full : full.slice(0, full.lastIndexOf(" ", 600)) + "…";

    return {
      content: JSON.stringify({ answer, grounded: true, citationIds: usedIds }),
    };
  };
}
