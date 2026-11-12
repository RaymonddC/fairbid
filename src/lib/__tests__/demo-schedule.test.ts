import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANSWER_DELAYS_MS,
  BID_DELAYS_MS,
  BID_JITTER_MS,
  isDemoOwner,
  offsets,
  scheduleDemoAnswers,
  scheduleDemoBids,
  type ScheduleDeps,
} from "../agents/demo-schedule";

const KEYS = new Map([
  ["seller-a", "ka"],
  ["seller-b", "kb"],
  ["seller-c", "kc"],
  ["seller-d", "kd"],
]);

function harness(over: Partial<ScheduleDeps> = {}) {
  const calls: { sellerId: string; key: string; at: number }[] = [];
  const logs: string[] = [];
  let clock = 0;
  const deps: ScheduleDeps = {
    ownerId: "buyer-anna",
    demoUserIds: ["buyer-anna", "seller-sari"],
    keys: KEYS,
    runOne: async (sellerId, key) => {
      calls.push({ sellerId, key, at: clock });
      return [{ seller: sellerId, tenderId: "t1", action: "bid", detail: "ok" }];
    },
    sleep: async (ms) => {
      clock += ms;
    },
    random: () => 0.5, // no jitter
    log: (l) => logs.push(l),
    ...over,
  };
  return { deps, calls, logs, now: () => clock };
}

describe("demo bidder agent schedule", () => {
  it("only runs for demo tender owners", async () => {
    assert.equal(isDemoOwner("buyer-anna", ["buyer-anna"]), true);
    assert.equal(isDemoOwner("real-owner", ["buyer-anna"]), false);
    const h = harness({ ownerId: "real-owner" });
    assert.deepEqual(await scheduleDemoBids("t1", h.deps), []);
    assert.deepEqual(await scheduleDemoAnswers("t1", h.deps), []);
    assert.equal(h.calls.length, 0);
  });

  it("bids one agent at a time, in persona order, at about 20, 45, 75 and 105 seconds", async () => {
    const h = harness();
    await scheduleDemoBids("t1", h.deps);
    assert.deepEqual(
      h.calls.map((c) => c.sellerId),
      ["seller-a", "seller-b", "seller-c", "seller-d"],
    );
    assert.deepEqual(
      h.calls.map((c) => c.at),
      [...BID_DELAYS_MS],
    );
    assert.equal(h.calls[0].key, "ka");
  });

  it("keeps jittered offsets within bounds and increasing", () => {
    for (const r of [0, 0.25, 0.999]) {
      const at = offsets(BID_DELAYS_MS, BID_JITTER_MS, () => r);
      at.forEach((t, i) => assert.ok(Math.abs(t - BID_DELAYS_MS[i]) <= BID_JITTER_MS));
      for (let i = 1; i < at.length; i++) assert.ok(at[i] > at[i - 1]);
      assert.ok(at[at.length - 1] <= 120_000);
    }
  });

  it("stops bidding once the tender is no longer open", async () => {
    let open = 2;
    const h = harness({ isOpen: async () => open-- > 0 });
    await scheduleDemoBids("t1", h.deps);
    assert.deepEqual(
      h.calls.map((c) => c.sellerId),
      ["seller-a", "seller-b"],
    );
    assert.ok(h.logs.some((l) => l.includes("no longer open")));
  });

  it("answers within about 20 to 40 seconds, without an open check", async () => {
    const h = harness({ isOpen: async () => false });
    await scheduleDemoAnswers("t1", h.deps);
    assert.deepEqual(
      h.calls.map((c) => c.at),
      [...ANSWER_DELAYS_MS],
    );
    assert.ok(h.calls.every((c) => c.at >= 17_000 && c.at <= 43_000));
  });

  it("a failing agent is logged and the rest still run", async () => {
    const h = harness({
      runOne: async (sellerId) => {
        if (sellerId === "seller-b") throw new Error("boom");
        return [];
      },
    });
    const steps = await scheduleDemoBids("t1", h.deps);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].action, "error");
    assert.equal(h.logs.length, 4);
    assert.ok(h.logs.some((l) => l.includes("failed: boom")));
  });

  it("says so in the log when no keys are set", async () => {
    const h = harness({ keys: new Map() });
    assert.deepEqual(await scheduleDemoBids("t1", h.deps), []);
    assert.ok(h.logs[0].includes("MCP_SELLER_KEYS is empty"));
  });
});
