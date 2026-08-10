import { Router, type Request, type Response } from "express";
import { createStatewaveChatAdapter } from "chat-core";
import { store } from "../store.js";
import { completionFn } from "../completion.js";
import { validateChatRequest, isValidationError } from "../validate.js";
import { createSessionStore } from "../sessionStore.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { opsAuth } from "../middleware/opsAuth.js";

const router = Router();

const opsAdapter = createStatewaveChatAdapter({
  store,
  completionFn,
  persona:
    "an internal assistant for the GreenHaven content/QA team, helping them find and close gaps in the storefront assistant's knowledge base",
});

const sessions = createSessionStore();
const limiter = rateLimit({ windowMs: 60_000, max: 30 });
const requireOpsAuth = opsAuth();

router.use("/api/ops", requireOpsAuth);

const ALLOWED_READ_SUBJECTS = ["ops:coverage-gaps", "shop:products", "faq:service"];

/** Shape of the metadata carried on `ops:coverage-gaps` episodes (this route's own subject). */
interface GapMetadata {
  question?: string;
  status?: "open" | "resolved";
  timestamp?: string;
  resolvedAt?: string;
}

/**
 * Ops chat route — the human-facing half of the coverage-gap loop. Reads
 * ops:coverage-gaps (what shoppers asked that we couldn't answer) alongside
 * shop:products + faq:service so the content owner can ask things like
 * "what needs fixing this week?" and get a grounded, cited answer back.
 */
router.post("/api/ops/chat", limiter, async (req: Request, res: Response) => {
  const parsed = validateChatRequest(req.body);
  if (isValidationError(parsed)) return res.status(400).json({ error: parsed.error });
  const { message, sessionId, readSubjects, retrievalConfig } = parsed;

  const session = sessions.get(sessionId, `ops_${Date.now()}`);

  const requestedSubjects = readSubjects?.filter((s) => ALLOWED_READ_SUBJECTS.includes(s));

  const result = await opsAdapter.sendMessage(session, message, {
    readSubjects: requestedSubjects?.length ? requestedSubjects : ALLOWED_READ_SUBJECTS,
    retrievalConfig: retrievalConfig || { globalMaxTokens: 2400 },
    writeSubject: "ops:conversations",
  });

  session.history.push({ role: "user", content: message }, { role: "assistant", content: result.answer });
  session.history = session.history.slice(-12);
  sessions.save(session);

  res.json(result);
});

/** Direct, reliable listing — not dependent on retrieval scoring — for a dashboard view. */
router.get("/api/ops/gaps", (req: Request, res: Response) => {
  const gaps = store
    .compileSubject("ops:coverage-gaps")
    .map((ep) => {
      const metadata = ep.metadata as GapMetadata;
      return {
        sourceId: ep.sourceId,
        question: metadata.question,
        status: metadata.status,
        timestamp: metadata.timestamp,
      };
    })
    .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime());

  res.json({
    open: gaps.filter((g) => g.status === "open"),
    resolved: gaps.filter((g) => g.status === "resolved"),
  });
});

/**
 * Resolving a gap writes a NEW episode with the SAME sourceId as the
 * original gap. StatewaveStore.compileSubject keeps only the newest episode
 * per sourceId, so this supersedes the "open" fact with a "resolved" one —
 * append-only memory, no in-place mutation.
 */
router.post("/api/ops/gaps/:sourceId/resolve", (req: Request, res: Response) => {
  const { sourceId } = req.params;
  if (typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > 200) {
    return res.status(400).json({ error: "invalid sourceId" });
  }

  const existing = store.compileSubject("ops:coverage-gaps").find((ep) => ep.sourceId === sourceId);
  if (!existing) return res.status(404).json({ error: "gap not found" });

  const existingMetadata = existing.metadata as GapMetadata;

  store.createEpisode({
    subject: "ops:coverage-gaps",
    sourceId,
    text: `Coverage gap resolved: "${existingMetadata.question}" is now answerable — content has been updated.`,
    metadata: { ...existingMetadata, status: "resolved", resolvedAt: new Date().toISOString() },
  });

  res.json({ ok: true, sourceId });
});

export default router;
