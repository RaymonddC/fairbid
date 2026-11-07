import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../password";

describe("password hashing", () => {
  it("accepts the right password and refuses a wrong one", () => {
    const stored = hashPassword("correct horse");
    assert.equal(verifyPassword("correct horse", stored), true);
    assert.equal(verifyPassword("correct horsE", stored), false);
  });

  it("salts every hash, so the same password never stores the same value", () => {
    assert.notEqual(hashPassword("same"), hashPassword("same"));
  });

  it("never matches a malformed stored value", () => {
    assert.equal(verifyPassword("x", "plain-text"), false);
    assert.equal(verifyPassword("x", "scrypt$abc$def"), false);
  });

  it("has a dummy hash that matches nothing a user would type", () => {
    assert.equal(verifyPassword("fairbid-demo", DUMMY_HASH), false);
  });
});
