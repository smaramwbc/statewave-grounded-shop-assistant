import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { opsAuth } from "../src/middleware/opsAuth.js";

function mockReqRes(authHeader: string | undefined) {
  const req = { get: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : undefined) };
  let statusCode: number | null = null;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };
  return { req, res, result: () => ({ statusCode, body }) };
}

test("allows all requests through when OPS_API_KEY is unset", () => {
  delete process.env.OPS_API_KEY;
  const middleware = opsAuth();
  const { req, res } = mockReqRes(undefined);
  let nextCalled = false;
  middleware(req as unknown as Request, res as unknown as Response, () => (nextCalled = true));
  assert.equal(nextCalled, true);
});

test("rejects requests with no token when OPS_API_KEY is set", () => {
  process.env.OPS_API_KEY = "secret123";
  const middleware = opsAuth();
  const { req, res, result } = mockReqRes(undefined);
  let nextCalled = false;
  middleware(req as unknown as Request, res as unknown as Response, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(result().statusCode, 401);
  delete process.env.OPS_API_KEY;
});

test("rejects requests with the wrong token", () => {
  process.env.OPS_API_KEY = "secret123";
  const middleware = opsAuth();
  const { req, res, result } = mockReqRes("Bearer wrong-token");
  let nextCalled = false;
  middleware(req as unknown as Request, res as unknown as Response, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(result().statusCode, 401);
  delete process.env.OPS_API_KEY;
});

test("allows requests with the correct token", () => {
  process.env.OPS_API_KEY = "secret123";
  const middleware = opsAuth();
  const { req, res } = mockReqRes("Bearer secret123");
  let nextCalled = false;
  middleware(req as unknown as Request, res as unknown as Response, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  delete process.env.OPS_API_KEY;
});
