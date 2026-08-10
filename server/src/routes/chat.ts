import { Router, type Request, type Response } from "express";
import { createStatewaveChatAdapter } from "chat-core";
import { store } from "../store.js";
import { completionFn } from "../completion.js";
import { validateChatRequest, isValidationError } from "../validate.js";
import { createSessionStore } from "../sessionStore.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const shopperAdapter = createStatewaveChatAdapter({
  store,
  completionFn,
  persona:
    "a helpful storefront assistant for GreenHaven Outdoor & Garden, an online garden and outdoor-living shop",
});

const sessions = createSessionStore();
const limiter = rateLimit({ windowMs: 60_000, max: 30 });

const ALLOWED_READ_SUBJECTS = ["shop:products", "faq:service", "content:guides"];

/**
 * Storefront chat route. Read-only over shop:products + faq:service +
 * content:guides. When an answer isn't grounded, the gap is written into
 * ops:coverage-gaps — this is the write side the Ops Assistant reads from.
 */
router.post("/api/chat", limiter, async (req: Request, res: Response) => {
  const parsed = validateChatRequest(req.body);
  if (isValidationError(parsed)) return res.status(400).json({ error: parsed.error });
  const { message, sessionId, readSubjects, retrievalConfig } = parsed;

  const session = sessions.get(sessionId, `sess_${Date.now()}`);

  const requestedSubjects = readSubjects?.filter((s) => ALLOWED_READ_SUBJECTS.includes(s));

  const result = await shopperAdapter.sendMessage(session, message, {
    readSubjects: requestedSubjects?.length ? requestedSubjects : ALLOWED_READ_SUBJECTS,
    retrievalConfig: retrievalConfig || { globalMaxTokens: 2000 },
    writeSubject: "shop:conversations",
  });

  session.history.push({ role: "user", content: message }, { role: "assistant", content: result.answer });
  session.history = session.history.slice(-12);
  sessions.save(session);

  if (!result.grounded || result.citations.length === 0) {
    store.createEpisode({
      subject: "ops:coverage-gaps",
      sourceId: `gap_${session.id}_${Date.now()}`,
      text:
        `Coverage gap: a shopper asked "${message}" and the assistant could not find grounded evidence ` +
        `in shop:products or faq:service to answer it. This needs new or updated content.`,
      metadata: { question: message, sessionId: session.id, status: "open", timestamp: new Date().toISOString() },
    });
  }

  res.json(result);
});

export default router;
