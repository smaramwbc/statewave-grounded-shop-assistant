import type { Request, Response, NextFunction, RequestHandler } from "express";

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

/**
 * Minimal in-memory sliding-window rate limiter, keyed by IP. No external
 * dependency needed for a demo of this size — swap for a shared store
 * (Redis, etc.) if this ever runs behind more than one process.
 */
export function rateLimit({ windowMs = 60_000, max = 30 }: RateLimitOptions = {}): RequestHandler {
  const hits = new Map<string, number[]>(); // ip -> [timestamps]

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits) {
      const kept = timestamps.filter((t) => t > cutoff);
      if (kept.length) hits.set(ip, kept);
      else hits.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(ip) || []).filter((t) => t > cutoff);

    if (timestamps.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      res.status(429).json({ error: "Too many requests, please slow down." });
      return;
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
}
