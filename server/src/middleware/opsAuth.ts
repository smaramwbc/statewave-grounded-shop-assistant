import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Protects /api/ops/* with a static bearer token from OPS_API_KEY.
 * If OPS_API_KEY is unset, ops routes stay open (zero-setup demo default)
 * but a loud warning is logged once on boot — see server/src/index.ts.
 */
export function opsAuth(): RequestHandler {
  const key = process.env.OPS_API_KEY;
  const keyBuffer = key ? Buffer.from(key) : null;

  return function opsAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!key || !keyBuffer) {
      next();
      return;
    }

    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const tokenBuffer = Buffer.from(token);

    const matches =
      tokenBuffer.length === keyBuffer.length && timingSafeEqual(tokenBuffer, keyBuffer);

    if (!matches) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
