export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  content: string;
}

export type CompletionFn = (
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal }
) => Promise<CompletionResult>;

/** The Evidence shape chat-core needs — matches statewave-core's getContext() output. */
export interface Evidence {
  evidenceId: string;
  subject: string;
  sourceId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/** The Citation shape chat-core needs — matches statewave-core's resolveCitations() output. */
export interface Citation {
  evidenceId: string;
  subject: string;
  sourceId: string;
  label: string;
  snippet: string;
}

/**
 * The store contract chat-core needs. Deliberately structural (not imported
 * from statewave-core) so chat-core stays framework/store-agnostic — any
 * Statewave-compatible store satisfies this without a hard dependency.
 */
export interface ChatStore {
  getContext(params: { readSubjects: string[]; query: string; globalMaxTokens?: number }): Evidence[];
  resolveCitations(evidence: Evidence[], citationIds: string[]): Citation[];
  createEpisode(input: {
    subject: string;
    sourceId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): unknown;
}

export interface ChatSession {
  id: string;
  history?: ChatMessage[];
}

export interface SendMessageConfig {
  readSubjects: string[];
  retrievalConfig?: { globalMaxTokens?: number };
  writeSubject?: string;
  signal?: AbortSignal;
}

export interface SendMessageResult {
  answer: string;
  grounded: boolean;
  citations: Citation[];
  warnings: string[];
  evidenceCount?: number;
}
