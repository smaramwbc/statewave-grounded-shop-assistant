import type { ChatMessage } from "chat-core";

/**
 * In-memory chat session store shared by both routes. Bounded by a TTL and
 * a max entry count so a long-running server can't grow the sessions Map
 * without limit — each entry is small, but unbounded is still unbounded.
 */
const TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity
const MAX_SESSIONS = 5000;

export interface ChatSessionRecord {
  id: string;
  history: ChatMessage[];
  lastSeen: number;
}

export interface SessionStore {
  get(sessionId: string | undefined, fallbackId: string): ChatSessionRecord;
  save(session: ChatSessionRecord): void;
}

export function createSessionStore(): SessionStore {
  // id -> { id, history, lastSeen }. A Map iterates in insertion order and
  // touch() re-inserts a session on every use, so the first key is always the
  // least recently used one.
  const sessions = new Map<string, ChatSessionRecord>();

  function touch(session: ChatSessionRecord): void {
    session.lastSeen = Date.now();
    sessions.delete(session.id);
    sessions.set(session.id, session);
  }

  function evictExpired(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, session] of sessions) {
      if (session.lastSeen < cutoff) sessions.delete(id);
    }
  }

  function evictOldestIfFull(): void {
    if (sessions.size < MAX_SESSIONS) return;
    const oldestId = sessions.keys().next().value;
    if (oldestId !== undefined) sessions.delete(oldestId);
  }

  setInterval(evictExpired, 5 * 60 * 1000).unref();

  return {
    get(sessionId, fallbackId) {
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
        touch(existing);
        return existing;
      }
      evictOldestIfFull();
      const session: ChatSessionRecord = { id: sessionId || fallbackId, history: [], lastSeen: Date.now() };
      sessions.set(session.id, session);
      return session;
    },
    save(session) {
      touch(session);
    },
  };
}
