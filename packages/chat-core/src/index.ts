import { buildSystemPrompt, buildEvidenceBlock } from "./prompt.js";
import type {
  ChatMessage,
  ChatSession,
  ChatStore,
  CompletionFn,
  CompletionResult,
  SendMessageConfig,
  SendMessageResult,
} from "./types.js";

export * from "./types.js";
export { createOpenRouterCompletionFn } from "./completion/openrouter.js";
export { createLiteLLMCompletionFn } from "./completion/litellm.js";
export { createOfflineCompletionFn } from "./completion/offline.js";

interface ParsedModelJson {
  answer: string;
  grounded: boolean;
  citationIds: string[];
  invalidJson?: boolean;
}

function parseModelJson(raw: string): ParsedModelJson {
  const cleaned = raw.trim().replace(/^```json\s*|```$/g, "");
  try {
    const parsed = JSON.parse(cleaned);
    return {
      answer: String(parsed.answer ?? ""),
      grounded: Boolean(parsed.grounded),
      citationIds: Array.isArray(parsed.citationIds) ? parsed.citationIds : [],
    };
  } catch {
    return { answer: cleaned, grounded: false, citationIds: [], invalidJson: true };
  }
}

export interface CreateAdapterOptions {
  store: ChatStore;
  completionFn: CompletionFn;
  persona?: string;
}

export interface StatewaveChatAdapter {
  sendMessage(session: ChatSession, userText: string, config: SendMessageConfig): Promise<SendMessageResult>;
}

/**
 * createStatewaveChatAdapter — the one thing every integration (server route,
 * React provider, vanilla widget) calls through. Orchestrates a full turn:
 * retrieve -> build prompt -> call the model -> validate citations -> persist.
 */
export function createStatewaveChatAdapter({ store, completionFn, persona }: CreateAdapterOptions): StatewaveChatAdapter {
  return {
    async sendMessage(session, userText, config) {
      const { readSubjects, retrievalConfig = {}, writeSubject, signal } = config;

      const evidence = store.getContext({
        readSubjects,
        query: userText,
        globalMaxTokens: retrievalConfig.globalMaxTokens ?? 2000,
      });

      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt({ persona }) },
        ...(session.history || []),
        { role: "user", content: `${buildEvidenceBlock(evidence)}\n\nQuestion: ${userText}` },
      ];

      let raw: CompletionResult;
      try {
        raw = await completionFn(messages, { signal });
      } catch (err) {
        return {
          answer: "The assistant is temporarily unavailable. Please try again shortly.",
          grounded: false,
          citations: [],
          warnings: [`completion_error: ${err instanceof Error ? err.message : String(err)}`],
        };
      }

      const parsed = parseModelJson(raw.content);
      const warnings: string[] = [];
      if (parsed.invalidJson) warnings.push("model_returned_invalid_json");

      const validIds = parsed.citationIds.filter((id) => evidence.some((e) => e.evidenceId === id));
      const droppedIds = parsed.citationIds.filter((id) => !validIds.includes(id));
      if (droppedIds.length) warnings.push(`unknown_citation_ids: ${droppedIds.join(",")}`);

      const citations = store.resolveCitations(evidence, validIds);
      const grounded = parsed.grounded && citations.length > 0;

      if (writeSubject) {
        store.createEpisode({
          subject: writeSubject,
          sourceId: `turn_${session.id}_${Date.now()}`,
          text: `Shopper asked: "${userText}" — Assistant answered: "${parsed.answer}"`,
          metadata: { sessionId: session.id, question: userText, grounded, timestamp: new Date().toISOString() },
        });
      }

      return { answer: parsed.answer, grounded, citations, warnings, evidenceCount: evidence.length };
    },
  };
}
