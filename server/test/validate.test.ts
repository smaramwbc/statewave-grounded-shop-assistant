import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChatRequest, isValidationError } from "../src/validate.js";

test("rejects missing message", () => {
  const result = validateChatRequest({});
  assert.equal(result.error, "message is required");
});

test("rejects overly long message", () => {
  const result = validateChatRequest({ message: "a".repeat(2001) });
  assert.match(result.error ?? "", /2000 characters/);
});

test("rejects non-array readSubjects", () => {
  const result = validateChatRequest({ message: "hi", readSubjects: "shop:products" });
  assert.match(result.error ?? "", /readSubjects/);
});

test("rejects readSubjects with non-string entries", () => {
  const result = validateChatRequest({ message: "hi", readSubjects: ["ok", 123] });
  assert.match(result.error ?? "", /readSubjects/);
});

test("rejects out-of-range globalMaxTokens", () => {
  const result = validateChatRequest({ message: "hi", retrievalConfig: { globalMaxTokens: 999999 } });
  assert.match(result.error ?? "", /globalMaxTokens/);
});

test("accepts a valid minimal request", () => {
  const result = validateChatRequest({ message: "hello there" });
  if (isValidationError(result)) throw new Error(`expected no error, got: ${result.error}`);
  assert.equal(result.message, "hello there");
});

test("passes through valid readSubjects and globalMaxTokens", () => {
  const result = validateChatRequest({
    message: "hi",
    readSubjects: ["shop:products"],
    retrievalConfig: { globalMaxTokens: 1500 },
  });
  if (isValidationError(result)) throw new Error(`expected no error, got: ${result.error}`);
  assert.deepEqual(result.readSubjects, ["shop:products"]);
  assert.equal(result.retrievalConfig?.globalMaxTokens, 1500);
});
