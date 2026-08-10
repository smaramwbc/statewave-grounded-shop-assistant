import { test } from "node:test";
import assert from "node:assert/strict";
import { StatewaveStore } from "statewave-core";
import { createStatewaveChatAdapter } from "../src/index.js";

function makeStoreWithOneProduct() {
  const store = new StatewaveStore();
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "Hosta likes full shade and moist soil." });
  return store;
}

test("drops citation ids that were not actually retrieved and does not claim grounded", async () => {
  const store = makeStoreWithOneProduct();
  const completionFn = async () =>
    ({ content: JSON.stringify({ answer: "It likes shade.", grounded: true, citationIds: ["S1", "S99"] }) });

  const adapter = createStatewaveChatAdapter({ store, completionFn, persona: "test" });
  const result = await adapter.sendMessage({ id: "s1", history: [] }, "what light does hosta need?", {
    readSubjects: ["shop:products"],
  });

  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].sourceId, "P1");
  assert.ok(result.warnings.some((w) => w.startsWith("unknown_citation_ids")));
});

test("grounded is false when model claims grounded but no citation survives validation", async () => {
  const store = makeStoreWithOneProduct();
  const completionFn = async () =>
    ({ content: JSON.stringify({ answer: "Not sure.", grounded: true, citationIds: ["S99"] }) });

  const adapter = createStatewaveChatAdapter({ store, completionFn, persona: "test" });
  const result = await adapter.sendMessage({ id: "s1", history: [] }, "unrelated question", {
    readSubjects: ["shop:products"],
  });

  assert.equal(result.grounded, false);
  assert.equal(result.citations.length, 0);
});

test("invalid model JSON is surfaced as a warning instead of throwing", async () => {
  const store = makeStoreWithOneProduct();
  const completionFn = async () => ({ content: "not json at all" });

  const adapter = createStatewaveChatAdapter({ store, completionFn, persona: "test" });
  const result = await adapter.sendMessage({ id: "s1", history: [] }, "hello", { readSubjects: ["shop:products"] });

  assert.ok(result.warnings.includes("model_returned_invalid_json"));
  assert.equal(result.grounded, false);
});

test("completionFn errors degrade gracefully instead of throwing", async () => {
  const store = makeStoreWithOneProduct();
  const completionFn = async () => {
    throw new Error("upstream down");
  };

  const adapter = createStatewaveChatAdapter({ store, completionFn, persona: "test" });
  const result = await adapter.sendMessage({ id: "s1", history: [] }, "hello", { readSubjects: ["shop:products"] });

  assert.equal(result.grounded, false);
  assert.match(result.answer, /temporarily unavailable/);
});

test("writeSubject persists a conversation episode", async () => {
  const store = makeStoreWithOneProduct();
  const completionFn = async () =>
    ({ content: JSON.stringify({ answer: "It likes shade.", grounded: true, citationIds: ["S1"] }) });

  const adapter = createStatewaveChatAdapter({ store, completionFn, persona: "test" });
  await adapter.sendMessage({ id: "sess_1", history: [] }, "what light?", {
    readSubjects: ["shop:products"],
    writeSubject: "shop:conversations",
  });

  assert.equal(store.compileSubject("shop:conversations").length, 1);
});
