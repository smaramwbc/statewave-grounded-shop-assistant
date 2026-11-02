import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionStore, type SessionStore } from "../src/sessionStore.js";

// Keep in sync with MAX_SESSIONS in ../src/sessionStore.ts.
const MAX_SESSIONS = 5000;

// Creates `count` sessions s-0 .. s-(count-1), each carrying a marker message
// so a later get() can tell a surviving session from a freshly created one.
function fill(store: SessionStore, count: number) {
  const sessions = [];
  for (let i = 0; i < count; i++) {
    const session = store.get(`s-${i}`, `fallback-${i}`);
    session.history.push({ role: "user", content: `marker-${i}` });
    sessions.push(session);
  }
  return sessions;
}

const survived = (store: SessionStore, i: number) => store.get(`s-${i}`, "unused").history.length === 1;

test("keeps every session until the store is full", () => {
  const store = createSessionStore();
  fill(store, MAX_SESSIONS);
  assert.ok(survived(store, 0));
  assert.ok(survived(store, MAX_SESSIONS - 1));
});

test("evicts the least recently used session, counting get and save as use", (t) => {
  // A frozen clock gives every session the same lastSeen, so only the order of
  // use can decide who is evicted.
  t.mock.method(Date, "now", () => 1_000_000);
  const store = createSessionStore();
  const sessions = fill(store, MAX_SESSIONS);

  store.get("s-0", "unused"); // used again through get()
  store.save(sessions[1]); // used again through save()

  store.get("new-1", "unused"); // full: evicts s-2, the least recently used
  store.get("new-2", "unused"); // evicts s-3

  // Check the survivors before the evicted ids: looking up a missing id
  // creates it, which evicts yet another session.
  assert.ok(survived(store, 0));
  assert.ok(survived(store, 1));
  assert.ok(survived(store, 4));
  assert.ok(survived(store, MAX_SESSIONS - 1));
  assert.ok(!survived(store, 2));
  assert.ok(!survived(store, 3));
});
