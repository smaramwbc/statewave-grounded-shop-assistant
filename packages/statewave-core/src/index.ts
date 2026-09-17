import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

const SAVE_DEBOUNCE_MS = 250;

const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","do","does","did","i","you","we","they",
  "it","of","to","in","on","for","and","or","what","when","how","where","which",
  "my","me","our","your","can","could","would","should","will","with","about",
  "this","that","these","those","have","has","had","be","been","if","so","up",
  "at","as","from","by","need","want","get","got"
]);

/** Free-form per-episode metadata. Callers know the shape for their own subjects. */
export type EpisodeMetadata = Record<string, unknown>;

export interface Episode {
  id: string;
  subject: string;
  sourceId: string;
  text: string;
  metadata: EpisodeMetadata;
  contentHash: string;
  createdAt: string;
}

export interface CreateEpisodeInput {
  subject: string;
  sourceId: string;
  text: string;
  metadata?: EpisodeMetadata;
}

export interface CreateEpisodeResult {
  deduped: boolean;
  id: string | null;
}

export interface EvidenceItem {
  evidenceId: string;
  subject: string;
  sourceId: string;
  text: string;
  metadata: EpisodeMetadata;
}

export interface Citation {
  evidenceId: string;
  subject: string;
  sourceId: string;
  label: string;
  snippet: string;
}

export interface GetContextParams {
  readSubjects: string[];
  query: string;
  globalMaxTokens?: number;
}

export interface StoreOptions {
  persistPath?: string | null;
}

interface PersistedShape {
  episodes?: Episode[];
}

type ScoredEpisode = Episode & { _score: number };

interface RankedBucket {
  subject: string;
  memories: ScoredEpisode[];
  cursor: number;
  budget: number;
  used: number;
}

function tokenize(text: string | undefined | null): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function contentHash(subject: string, sourceId: string, text: string): string {
  return createHash("sha256").update(`${subject}::${sourceId}::${text}`).digest("hex");
}

/** Rough token estimate (words * 1.3), good enough for a demo token budget. */
function estimateTokens(text: string | undefined | null): number {
  return Math.ceil((text || "").split(/\s+/).filter(Boolean).length * 1.3);
}

function scoreMemory(queryTokens: string[], memory: Episode): number {
  const memTokens = tokenize(memory.text + " " + JSON.stringify(memory.metadata || {}));
  if (queryTokens.length === 0 || memTokens.length === 0) return 0;
  const memSet = new Set(memTokens);
  let overlap = 0;
  for (const t of queryTokens) if (memSet.has(t)) overlap++;
  let score = overlap / Math.sqrt(memTokens.length);

  // Recency boost for anything carrying a timestamp (used heavily by ops:coverage-gaps).
  const timestamp = memory.metadata?.timestamp;
  if (typeof timestamp === "string") {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - ageDays / 14) * 0.5;
  }
  // Open items should surface ahead of resolved ones in the ops feed.
  if (memory.metadata?.status === "open") score += 0.75;

  return score;
}

/**
 * StatewaveStore mirrors the real Statewave contract at demo scale:
 * createEpisode (append fact) -> compileSubject (dedupe into Memories)
 * -> getContext (retrieve + budget + citation IDs) -> resolveCitations.
 */
export class StatewaveStore {
  persistPath: string | null;
  episodes: Map<string, Episode>;
  hashIndex: Set<string>;
  private _saveTimer: ReturnType<typeof setTimeout> | null;
  private _dirty: boolean;

  constructor({ persistPath }: StoreOptions = {}) {
    this.persistPath = persistPath || null;
    this.episodes = new Map(); // id -> episode
    this.hashIndex = new Set(); // contentHash set, for idempotent ingestion
    this._saveTimer = null;
    this._dirty = false;
    this._load();
  }

  private _load(): void {
    const filePath = this.persistPath;
    if (!filePath || !existsSync(filePath)) return;
    try {
      const raw: PersistedShape = JSON.parse(readFileSync(filePath, "utf-8"));
      for (const ep of raw.episodes || []) {
        this.episodes.set(ep.id, ep);
        this.hashIndex.add(ep.contentHash);
      }
    } catch (err) {
      // A truncated/corrupt db.json (e.g. process killed mid-write) should not
      // take the whole server down — start from an empty store instead. The
      // store keeps writing to the same path though, so the unreadable file
      // would be overwritten by the first save, within SAVE_DEBOUNCE_MS of the
      // next episode. Move it aside first: whatever is still recoverable in it
      // has to outlive the warning that points at it.
      const message = err instanceof Error ? err.message : String(err);
      const keptPath = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      try {
        renameSync(filePath, keptPath);
        console.warn(
          `StatewaveStore: could not read ${filePath} (${message}). ` +
            `Kept the unreadable file as ${keptPath} and started from an empty store — ` +
            `restore from it if this is unexpected.`
        );
      } catch (keepErr) {
        // The only copy cannot be preserved, so stop persisting rather than
        // overwrite it: an operator can repair or remove the file and restart.
        const keepMessage = keepErr instanceof Error ? keepErr.message : String(keepErr);
        this.persistPath = null;
        console.warn(
          `StatewaveStore: could not read ${filePath} (${message}) ` +
            `and could not move it aside (${keepMessage}). ` +
            `Running in memory and leaving the file untouched — nothing is persisted until it is repaired or removed.`
        );
      }
    }
  }

  /**
   * Writes are debounced: a burst of createEpisode calls (e.g. ingestion, or
   * several chat turns landing close together) coalesces into a single
   * writeFileSync instead of rewriting the whole store on every call.
   */
  private _save(): void {
    if (!this.persistPath) return;
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    this._saveTimer.unref?.();
  }

  /** Forces any pending write out immediately — call this before process exit. */
  flush(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this.persistPath || !this._dirty) return;
    mkdirSync(dirname(this.persistPath), { recursive: true });
    writeFileSync(
      this.persistPath,
      JSON.stringify({ episodes: [...this.episodes.values()] }, null, 2)
    );
    this._dirty = false;
  }

  /**
   * Append one fact. Idempotent by content hash (subject+sourceId+text),
   * so re-running an ingestion job nightly does not duplicate unchanged rows.
   */
  createEpisode({ subject, sourceId, text, metadata = {} }: CreateEpisodeInput): CreateEpisodeResult {
    const hash = contentHash(subject, sourceId, text);
    if (this.hashIndex.has(hash)) {
      return { deduped: true, id: null };
    }
    const id = `ep_${hash.slice(0, 16)}`;
    const episode: Episode = {
      id,
      subject,
      sourceId,
      text,
      metadata,
      contentHash: hash,
      createdAt: new Date().toISOString(),
    };
    this.episodes.set(id, episode);
    this.hashIndex.add(hash);
    this._save();
    return { deduped: false, id };
  }

  /**
   * Compile a Subject: episodes are grouped by sourceId and only the newest
   * episode per sourceId is kept as a "Memory" — this is what makes ingestion
   * safe to re-run: updated rows replace old facts instead of piling up.
   */
  compileSubject(subject: string): Episode[] {
    const bySource = new Map<string, Episode>();
    for (const ep of this.episodes.values()) {
      if (ep.subject !== subject) continue;
      const existing = bySource.get(ep.sourceId);
      if (!existing || existing.createdAt < ep.createdAt) {
        bySource.set(ep.sourceId, ep);
      }
    }
    return [...bySource.values()];
  }

  /**
   * getContext(question): retrieve the most relevant Memories across one or
   * more read Subjects, merged round-robin and deduplicated, capped at a
   * global token budget split evenly across subjects.
   */
  getContext({ readSubjects, query, globalMaxTokens = 2000 }: GetContextParams): EvidenceItem[] {
    const queryTokens = tokenize(query);
    const perSubjectBudget = Math.floor(globalMaxTokens / Math.max(1, readSubjects.length));

    const ranked: RankedBucket[] = readSubjects.map((subject) => {
      const memories = this.compileSubject(subject)
        .map((m): ScoredEpisode => ({ ...m, _score: scoreMemory(queryTokens, m) }))
        .filter((m) => m._score > 0)
        .sort((a, b) => b._score - a._score);
      return { subject, memories, cursor: 0, budget: perSubjectBudget, used: 0 };
    });

    const evidence: ScoredEpisode[] = [];
    let round = true;
    while (round) {
      round = false;
      for (const bucket of ranked) {
        // A candidate that is too big for what is left of this subject's budget
        // is skipped, not treated as the end of the subject: lower-ranked
        // memories are usually short and still fit. The cursor only ever moves
        // forward, so a subject stops contributing once nothing left fits.
        while (bucket.cursor < bucket.memories.length) {
          const candidate = bucket.memories[bucket.cursor];
          bucket.cursor++;
          const cost = estimateTokens(candidate.text);
          if (bucket.used + cost > bucket.budget) continue;
          bucket.used += cost;
          evidence.push(candidate);
          round = true;
          break;
        }
      }
    }

    return evidence.map((m, i) => ({
      evidenceId: `S${i + 1}`,
      subject: m.subject,
      sourceId: m.sourceId,
      text: m.text,
      metadata: m.metadata,
    }));
  }

  /** Server-side only: resolve opaque evidence IDs back to real, citable sources. */
  resolveCitations(evidence: EvidenceItem[], citationIds: string[]): Citation[] {
    const byId = new Map(evidence.map((e) => [e.evidenceId, e]));
    return citationIds
      .filter((id) => byId.has(id))
      .map((id) => {
        const e = byId.get(id)!;
        return {
          evidenceId: e.evidenceId,
          subject: e.subject,
          sourceId: e.sourceId,
          label: (e.metadata?.label as string | undefined) || e.sourceId,
          snippet: e.text.slice(0, 220),
        };
      });
  }
}
