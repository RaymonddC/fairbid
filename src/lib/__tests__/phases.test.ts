import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignPhases, HOLD_SPAN_DAYS, isLastOfPhase, isLive, nextStep, owedInPhase, phaseCount, planMilestones, type HoldState } from "../phases";
import { DEFAULT_MILESTONES, milestoneAmounts } from "../tender";

const DAY = 86_400_000;
const NOW = new Date("2026-11-08T12:00:00Z");
const held = (phase: number, over: Partial<HoldState> = {}): HoldState => ({
  phase,
  paypalAuthId: `AUTH${phase}`,
  status: "CREATED",
  expiresAt: new Date(NOW.getTime() + 20 * DAY),
  ...over,
});

describe("planning an order", () => {
  it("keeps an order of 28 days or less to the usual three steps and one hold", () => {
    for (const days of [1, 7, 21, 28]) {
      const plan = planMilestones(days);
      assert.deepEqual(
        plan.map((m) => [m.name, m.pct]),
        DEFAULT_MILESTONES.map((m) => [m.name, m.pct]),
        `${days} days`,
      );
      assert.equal(phaseCount(plan), 1, `${days} days`);
      assert.equal(plan.at(-1)!.dueDay, days);
    }
  });

  it("splits a two-month order into three holds", () => {
    const plan = planMilestones(60);
    assert.deepEqual(
      plan.map((m) => [m.name, m.pct, m.dueDay, m.phase]),
      [
        ["Production started", 30, 20, 1],
        ["Shipped with tracking", 40, 40, 2],
        ["Delivered and confirmed", 30, 60, 3],
      ],
    );
  });

  it("never asks one hold to cover more than 28 days of work, up to 180 days", () => {
    for (let days = 1; days <= 180; days++) {
      const plan = planMilestones(days);
      assert.equal(plan.reduce((s, m) => s + m.pct, 0), 100, `${days} days: percents`);
      assert.equal(plan.at(-1)!.dueDay, days, `${days} days: last step on the last day`);
      let start = 0;
      for (let p = 1; p <= phaseCount(plan); p++) {
        const steps = plan.filter((m) => m.phase === p);
        assert.ok(steps.length > 0, `${days} days: phase ${p} has steps`);
        assert.ok(steps.at(-1)!.dueDay - start <= HOLD_SPAN_DAYS, `${days} days: phase ${p} spans ${steps.at(-1)!.dueDay - start} days`);
        start = steps.at(-1)!.dueDay;
      }
      // Phases are numbered in order, without gaps.
      assert.deepEqual([...new Set(plan.map((m) => m.phase))], Array.from({ length: phaseCount(plan) }, (_, i) => i + 1));
    }
  });

  it("refuses windows it cannot plan", () => {
    assert.throws(() => planMilestones(0));
    assert.throws(() => planMilestones(181));
    assert.throws(() => planMilestones(2.5));
  });

  it("groups steps greedily into 28-day phases", () => {
    assert.deepEqual(assignPhases([9, 19, 28]), [1, 1, 1]);
    assert.deepEqual(assignPhases([10, 20, 29]), [1, 1, 2]);
    // A phase starts when the one before is paid, at its last step's due day.
    assert.deepEqual(assignPhases([14, 28, 42, 56]), [1, 1, 2, 2]);
  });

  it("knows which step closes its phase's hold", () => {
    const ms = [{ phase: 1 }, { phase: 1 }, { phase: 2 }];
    assert.deepEqual([0, 1, 2].map((i) => isLastOfPhase(ms, i)), [false, true, true]);
  });

  it("splits the money so the steps add up to the order exactly", () => {
    const plan = planMilestones(120);
    assert.equal(milestoneAmounts(253_900, plan).reduce((s, a) => s + a, 0), 253_900);
  });
});

describe("what happens next", () => {
  const ms = (paid: boolean[], phases = [1, 2, 3]) => paid.map((p, i) => ({ phase: phases[i], plannedCents: [76_200, 101_600, 76_100][i], paid: p }));

  it("pays the next step when its phase is held", () => {
    assert.deepEqual(nextStep(ms([false, false, false]), [held(1)], NOW), { kind: "pay", index: 0, phase: 1 });
  });

  it("asks for the next phase's hold once a phase is paid", () => {
    assert.deepEqual(nextStep(ms([true, false, false]), [held(1, { status: "CAPTURED" })], NOW), {
      kind: "hold",
      index: 1,
      phase: 2,
      amountCents: 101_600,
      replacing: false,
    });
  });

  it("asks for a new hold when the phase's hold lapsed, for what the phase still owes", () => {
    const lapsed = held(2, { expiresAt: new Date(NOW.getTime() - DAY) });
    assert.deepEqual(nextStep(ms([true, false, false]), [held(1, { status: "CAPTURED" }), lapsed], NOW), {
      kind: "hold",
      index: 1,
      phase: 2,
      amountCents: 101_600,
      replacing: true,
    });
  });

  it("treats a hold PayPal voided, expired or denied as gone, even before its date", () => {
    for (const status of ["VOIDED", "EXPIRED", "DENIED", "CAPTURED"]) {
      assert.equal(isLive(held(1, { status }), NOW), false, status);
    }
    assert.equal(isLive(held(1), NOW), true);
    assert.equal(isLive(held(1, { paypalAuthId: null }), NOW), false, "not approved yet");
  });

  it("an unapproved order is not a hold and does not count as a replacement", () => {
    const step = nextStep(ms([true, false, false]), [held(1, { status: "CAPTURED" }), held(2, { paypalAuthId: null })], NOW);
    assert.equal(step.kind === "hold" && step.replacing, false);
  });

  it("uses the newest live hold when an old one for the same phase lapsed", () => {
    const old = held(1, { paypalAuthId: "OLD", expiresAt: new Date(NOW.getTime() - DAY) });
    const fresh = held(1, { paypalAuthId: "NEW" });
    assert.deepEqual(nextStep(ms([false, false, false], [1, 1, 1]), [old, fresh], NOW), { kind: "pay", index: 0, phase: 1 });
  });

  it("a one-phase order with a lapsed hold asks for a new hold of what is left", () => {
    const steps = ms([true, false, false], [1, 1, 1]);
    assert.equal(owedInPhase(steps, 1), 101_600 + 76_100);
    const step = nextStep(steps, [held(1, { status: "EXPIRED" })], NOW);
    assert.deepEqual(step, { kind: "hold", index: 1, phase: 1, amountCents: 177_700, replacing: true });
  });

  it("is done when every step is paid", () => {
    assert.deepEqual(nextStep(ms([true, true, true]), [], NOW), { kind: "done" });
  });
});
