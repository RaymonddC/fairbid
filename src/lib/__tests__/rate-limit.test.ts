import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLimiter } from "../rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit, then refuses", () => {
    const l = createLimiter(3, 60_000);
    assert.deepEqual([1, 2, 3, 4].map(() => l.hit("a", 0)), [true, true, true, false]);
  });

  it("counts each key on its own", () => {
    const l = createLimiter(1, 60_000);
    assert.equal(l.hit("a", 0), true);
    assert.equal(l.hit("b", 0), true);
    assert.equal(l.hit("a", 0), false);
  });

  it("forgets attempts older than the window", () => {
    const l = createLimiter(1, 1_000);
    assert.equal(l.hit("a", 0), true);
    assert.equal(l.hit("a", 500), false);
    assert.equal(l.hit("a", 1_600), true);
  });

  it("starts fresh after a reset", () => {
    const l = createLimiter(1, 60_000);
    l.hit("a", 0);
    l.reset("a");
    assert.equal(l.hit("a", 0), true);
  });
});
