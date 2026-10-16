import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { rateLimit } from "../src/middleware/rateLimit.js";

function hit(mw: ReturnType<typeof rateLimit>, ip: string | undefined) {
  const headers: Record<string, unknown> = {};
  let statusCode: number | null = null;
  const req = { ip, socket: {} };
  const res = {
    setHeader(name: string, value: unknown) {
      headers[name] = value;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  let nextCalled = false;
  mw(req as unknown as Request, res as unknown as Response, () => (nextCalled = true));
  return { nextCalled, statusCode, headers };
}

function hitWithSocket(
  mw: ReturnType<typeof rateLimit>,
  ip: string | undefined,
  remoteAddress: string | undefined,
) {
  const headers: Record<string, unknown> = {};
  let statusCode: number | null = null;
  const req = { ip, socket: { remoteAddress } };
  const res = {
    setHeader(name: string, value: unknown) {
      headers[name] = value;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  let nextCalled = false;
  mw(req as unknown as Request, res as unknown as Response, () => (nextCalled = true));
  return { nextCalled, statusCode, headers };
}

test("allows up to max requests, then returns 429 with Retry-After", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 2 });
  assert.equal(hit(mw, "1.1.1.1").nextCalled, true);
  assert.equal(hit(mw, "1.1.1.1").nextCalled, true);
  const blocked = hit(mw, "1.1.1.1");
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["Retry-After"], 60);
});

test("tracks each IP with its own counter", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 });
  assert.equal(hit(mw, "1.1.1.1").nextCalled, true);
  assert.equal(hit(mw, "1.1.1.1").nextCalled, false);
  assert.equal(hit(mw, "2.2.2.2").nextCalled, true);
});

test("uses the fallback key when req.ip is missing", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 });
  assert.equal(hitWithSocket(mw, undefined, "9.9.9.9").nextCalled, true);
  assert.equal(hit(mw, "9.9.9.9").nextCalled, false);

  const mwUnknown = rateLimit({ windowMs: 60_000, max: 1 });
  assert.equal(hit(mwUnknown, undefined).nextCalled, true);
  assert.equal(hit(mwUnknown, undefined).nextCalled, false);
});

test("allows requests again after the window passes", async () => {
  const mw = rateLimit({ windowMs: 50, max: 1 });
  assert.equal(hit(mw, "1.1.1.1").nextCalled, true);
  assert.equal(hit(mw, "1.1.1.1").nextCalled, false);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(hit(mw, "1.1.1.1").nextCalled, true);
});
