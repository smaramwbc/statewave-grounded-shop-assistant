import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatewaveStore } from "../src/index.js";

test("createEpisode dedupes identical subject+sourceId+text", () => {
  const store = new StatewaveStore();
  const first = store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "hosta" });
  const second = store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "hosta" });
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(store.compileSubject("shop:products").length, 1);
});

test("createEpisode does not dedupe when text changes", () => {
  const store = new StatewaveStore();
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "hosta v1" });
  const second = store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "hosta v2" });
  assert.equal(second.deduped, false);
});

test("compileSubject keeps only the newest episode per sourceId", async () => {
  const store = new StatewaveStore();
  store.createEpisode({ subject: "ops:coverage-gaps", sourceId: "gap_1", text: "open", metadata: { status: "open" } });
  await new Promise((r) => setTimeout(r, 5));
  store.createEpisode({ subject: "ops:coverage-gaps", sourceId: "gap_1", text: "resolved", metadata: { status: "resolved" } });

  const compiled = store.compileSubject("ops:coverage-gaps");
  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].metadata.status, "resolved");
});

test("getContext returns evidence with sequential ids and only from requested subjects", () => {
  const store = new StatewaveStore();
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "Hosta likes full shade and moist soil." });
  store.createEpisode({ subject: "faq:service", sourceId: "F1", text: "We ship within 5 days." });

  const evidence = store.getContext({ readSubjects: ["shop:products"], query: "shade plants" });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].evidenceId, "S1");
  assert.equal(evidence[0].subject, "shop:products");
});

test("getContext respects globalMaxTokens budget", () => {
  const store = new StatewaveStore();
  const longText = "shade ".repeat(500);
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: longText });
  store.createEpisode({ subject: "shop:products", sourceId: "P2", text: longText });

  const evidence = store.getContext({ readSubjects: ["shop:products"], query: "shade", globalMaxTokens: 50 });
  assert.ok(evidence.length <= 1, "should stop pulling more evidence once the budget is exhausted");
});

test("getContext skips a memory that does not fit and keeps filling from the same subject", () => {
  const store = new StatewaveStore();
  const short = `shade ${"mulch ".repeat(40)}`;
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "Hosta care in shade tolerant borders." });
  store.createEpisode({ subject: "shop:products", sourceId: "P2", text: `hosta care shade tolerant ${"mulch ".repeat(600)}` });
  for (const id of ["P3", "P4", "P5"]) {
    store.createEpisode({ subject: "shop:products", sourceId: id, text: short });
  }

  const query = "shade tolerant hosta care";
  const unbudgeted = store.getContext({ readSubjects: ["shop:products"], query, globalMaxTokens: 5000 });
  assert.deepEqual(
    unbudgeted.map((e) => e.sourceId),
    ["P1", "P2", "P3", "P4", "P5"],
    "premise: the long page ranks second, ahead of the short ones"
  );

  // 500 tokens fits P1 and every short memory, but not the ~786-token P2.
  const budgeted = store.getContext({ readSubjects: ["shop:products"], query, globalMaxTokens: 500 });
  assert.deepEqual(
    budgeted.map((e) => e.sourceId),
    ["P1", "P3", "P4", "P5"],
    "the oversized page is skipped, not treated as the end of the subject"
  );
});

test("createEpisode debounces disk writes; flush() forces a write immediately", () => {
  const dir = mkdtempSync(join(tmpdir(), "statewave-test-"));
  const persistPath = join(dir, "db.json");
  const store = new StatewaveStore({ persistPath });

  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "hosta" });
  assert.equal(existsSync(persistPath), false, "write should be debounced, not immediate");

  store.flush();
  assert.equal(existsSync(persistPath), true);
  const onDisk = JSON.parse(readFileSync(persistPath, "utf-8"));
  assert.equal(onDisk.episodes.length, 1);
});

test("flush() is a no-op when nothing is dirty", () => {
  const dir = mkdtempSync(join(tmpdir(), "statewave-test-"));
  const persistPath = join(dir, "db.json");
  const store = new StatewaveStore({ persistPath });

  store.flush();
  assert.equal(existsSync(persistPath), false, "flush with no pending writes should not create a file");
});

test("a corrupt persisted file does not crash construction, and starts empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "statewave-test-"));
  const persistPath = join(dir, "db.json");
  writeFileSync(persistPath, "{ not valid json");

  const store = new StatewaveStore({ persistPath });
  assert.equal(store.compileSubject("shop:products").length, 0);
});

test("resolveCitations drops ids that were not in the retrieved evidence", () => {
  const store = new StatewaveStore();
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "Hosta likes shade." });
  const evidence = store.getContext({ readSubjects: ["shop:products"], query: "shade" });

  const resolved = store.resolveCitations(evidence, ["S1", "S99"]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].sourceId, "P1");
});
