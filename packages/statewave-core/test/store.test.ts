import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

test("createEpisode records a row that reverts to an earlier value", async () => {
  const store = new StatewaveStore();
  const row = { subject: "shop:products", sourceId: "p1" };
  store.createEpisode({ ...row, text: "A" });
  await new Promise((r) => setTimeout(r, 5));
  store.createEpisode({ ...row, text: "B" });
  await new Promise((r) => setTimeout(r, 5));
  const reverted = store.createEpisode({ ...row, text: "A" });

  assert.equal(reverted.deduped, false);
  assert.equal(store.compileSubject("shop:products")[0].text, "A");
  assert.equal(
    store.createEpisode({ ...row, text: "A" }).deduped,
    true,
    "re-ingesting the current value is still a no-op"
  );
});

test("createEpisode keeps a single episode when the same new value is ingested twice", async () => {
  const store = new StatewaveStore();
  const row = { subject: "shop:products", sourceId: "p1" };
  store.createEpisode({ ...row, text: "A" });
  await new Promise((r) => setTimeout(r, 5));
  store.createEpisode({ ...row, text: "B" });
  const again = store.createEpisode({ ...row, text: "B" });

  assert.equal(again.deduped, true);
  assert.equal([...store.episodes.values()].filter((e) => e.text === "B").length, 1);
  assert.equal(store.compileSubject("shop:products")[0].text, "B");
});

test("compileSubject picks the later ingest when two rows land in the same millisecond", () => {
  mock.method(Date.prototype, "toISOString", () => "2026-10-06T00:00:00.000Z");
  try {
    const store = new StatewaveStore();
    const row = { subject: "shop:products", sourceId: "p1" };
    store.createEpisode({ ...row, text: "A" });
    store.createEpisode({ ...row, text: "B" });
    assert.equal(store.compileSubject("shop:products")[0].text, "B");

    store.createEpisode({ ...row, text: "A" });
    assert.equal(store.compileSubject("shop:products")[0].text, "A");
  } finally {
    mock.restoreAll();
  }
});

test("the latest value per source is remembered after a reload from disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "statewave-test-"));
  const persistPath = join(dir, "db.json");
  const row = { subject: "shop:products", sourceId: "p1" };
  const store = new StatewaveStore({ persistPath });
  store.createEpisode({ ...row, text: "A" });
  await new Promise((r) => setTimeout(r, 5));
  store.createEpisode({ ...row, text: "B" });
  store.flush();

  const reloaded = new StatewaveStore({ persistPath });
  assert.equal(reloaded.createEpisode({ ...row, text: "B" }).deduped, true);
  assert.equal(reloaded.createEpisode({ ...row, text: "A" }).deduped, false);
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

test("a corrupt persisted file is kept aside, so later writes cannot destroy it", () => {
  const dir = mkdtempSync(join(tmpdir(), "statewave-test-"));
  const persistPath = join(dir, "db.json");
  const corrupt = '{ "episodes": [{ "id": "ep_1", "subject": "shop:pro';
  writeFileSync(persistPath, corrupt);

  const store = new StatewaveStore({ persistPath });
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "hosta" });
  store.flush();

  const kept = readdirSync(dir).filter((name) => name.startsWith("db.json.corrupt-"));
  assert.equal(kept.length, 1, "the unreadable file should still be there to restore from");
  assert.equal(readFileSync(join(dir, kept[0]), "utf-8"), corrupt);
  assert.equal(JSON.parse(readFileSync(persistPath, "utf-8")).episodes.length, 1);
});

// Directory permissions are the only portable way to make renameSync fail, and
// root ignores them — Windows does not enforce them this way either.
const canBlockRename = process.platform !== "win32" && process.getuid?.() !== 0;

test("an unreadable file that cannot be kept aside is left untouched", { skip: !canBlockRename }, () => {
  const dir = mkdtempSync(join(tmpdir(), "statewave-test-"));
  const persistPath = join(dir, "db.json");
  const corrupt = "{ not valid json";
  writeFileSync(persistPath, corrupt);
  chmodSync(dir, 0o500);

  try {
    const store = new StatewaveStore({ persistPath });
    assert.equal(store.persistPath, null, "persistence should be dropped, not pointed at the only copy");
    store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "hosta" });
    store.flush();
    assert.equal(readFileSync(persistPath, "utf-8"), corrupt);
  } finally {
    chmodSync(dir, 0o700);
  }
});

test("resolveCitations drops ids that were not in the retrieved evidence", () => {
  const store = new StatewaveStore();
  store.createEpisode({ subject: "shop:products", sourceId: "P1", text: "Hosta likes shade." });
  const evidence = store.getContext({ readSubjects: ["shop:products"], query: "shade" });

  const resolved = store.resolveCitations(evidence, ["S1", "S99"]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].sourceId, "P1");
});
