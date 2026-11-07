import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENESIS_HASH, canonicalJson, chainEvent, verifyChain, type ChainedEvent } from "../audit";

function chain(count: number): ChainedEvent[] {
  const events: ChainedEvent[] = [];
  for (let seq = 1; seq <= count; seq++) {
    events.push(
      chainEvent(events.at(-1)?.hash ?? GENESIS_HASH, {
        tenderId: "t1",
        seq,
        actor: "agent",
        kind: "tool_call",
        payload: { step: seq },
        at: `2026-11-07T00:00:0${seq}.000Z`,
      }),
    );
  }
  return events;
}

describe("event chain", () => {
  it("verifies an untouched chain", () => {
    assert.deepEqual(verifyChain(chain(4)), { intact: true });
  });

  it("detects an edited payload", () => {
    const events = chain(4);
    events[1] = { ...events[1], payload: { step: 99 } };
    assert.deepEqual(verifyChain(events), { intact: false, firstBrokenSeq: 2 });
  });

  it("detects a removed event", () => {
    const events = chain(4);
    events.splice(1, 1);
    assert.deepEqual(verifyChain(events), { intact: false, firstBrokenSeq: 3 });
  });

  it("hashes the same content the same regardless of key order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
