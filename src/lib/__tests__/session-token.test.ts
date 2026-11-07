import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { signSession, verifySession } from "../session-token";

describe("session token", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret";
  });

  it("round-trips a signed id", () => {
    assert.equal(verifySession(signSession("buyer-anna")), "buyer-anna");
  });

  it("rejects a cookie edited to another user", () => {
    const [, expiry, signature] = signSession("seller-sari").split(".");
    assert.equal(verifySession(`buyer-anna.${expiry}.${signature}`), null);
  });

  it("rejects an expired cookie", () => {
    const token = signSession("buyer-anna", 1_000);
    assert.equal(verifySession(token, 2_000), null);
  });

  it("rejects a bare id and an empty cookie", () => {
    assert.equal(verifySession("buyer-anna"), null);
    assert.equal(verifySession(undefined), null);
  });

  it("refuses to run with no secret", () => {
    delete process.env.SESSION_SECRET;
    assert.throws(() => signSession("buyer-anna"), /SESSION_SECRET/);
  });
});
