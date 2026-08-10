const MAX_MESSAGE_LENGTH = 2000;
const MAX_READ_SUBJECTS = 10;
const MAX_GLOBAL_TOKENS = 8000;

interface RawChatRequestBody {
  sessionId?: unknown;
  message?: unknown;
  readSubjects?: unknown;
  retrievalConfig?: { globalMaxTokens?: unknown };
}

export interface ValidationError {
  error: string;
}

export interface ValidatedChatRequest {
  error?: undefined;
  message: string;
  sessionId?: string;
  readSubjects?: string[];
  retrievalConfig?: { globalMaxTokens: number };
}

/**
 * Narrows the validateChatRequest() union. A plain `if (parsed.error)` can't
 * do this on its own — `error` is a bare `string` on the failure branch, and
 * TypeScript can't rule out an (unused, in practice) empty-string case
 * collapsing both branches, so callers use this instead.
 */
export function isValidationError(result: ValidationError | ValidatedChatRequest): result is ValidationError {
  return typeof result.error === "string";
}

/**
 * Validates and normalizes a /api/chat or /api/ops/chat request body.
 * Returns { error } on failure, or { message, sessionId, readSubjects, retrievalConfig } on success.
 */
export function validateChatRequest(body: unknown): ValidationError | ValidatedChatRequest {
  const { sessionId, message, readSubjects, retrievalConfig } = (body || {}) as RawChatRequestBody;

  if (!message || typeof message !== "string") {
    return { error: "message is required" };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` };
  }

  if (sessionId !== undefined && typeof sessionId !== "string") {
    return { error: "sessionId must be a string" };
  }

  if (readSubjects !== undefined) {
    if (
      !Array.isArray(readSubjects) ||
      readSubjects.length > MAX_READ_SUBJECTS ||
      !readSubjects.every((s) => typeof s === "string")
    ) {
      return { error: `readSubjects must be an array of at most ${MAX_READ_SUBJECTS} strings` };
    }
  }

  let globalMaxTokens: number | undefined;
  if (retrievalConfig?.globalMaxTokens !== undefined) {
    const n = Number(retrievalConfig.globalMaxTokens);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_GLOBAL_TOKENS) {
      return { error: `retrievalConfig.globalMaxTokens must be a number between 1 and ${MAX_GLOBAL_TOKENS}` };
    }
    globalMaxTokens = n;
  }

  return {
    message,
    sessionId: sessionId as string | undefined,
    readSubjects: readSubjects as string[] | undefined,
    retrievalConfig: globalMaxTokens !== undefined ? { globalMaxTokens } : undefined,
  };
}
