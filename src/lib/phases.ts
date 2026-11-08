// How an order is paid when it takes longer than one PayPal hold can last. Pure: no
// database, no network, so every rule here is tested directly.
//
// A PayPal authorization is valid for 29 days and cannot be extended: reauthorizing
// only renews its 3-day honor period inside those 29 (DECISIONS.md). So an order is
// split into phases. Each phase is a run of milestones due within 28 days of the
// phase starting, and gets its own hold, which the buyer approves when the phase
// starts. An order of 28 days or less is one phase and one hold, as before.
//
// When a hold lapses before its phase is paid (production ran late), the buyer can
// place a new hold for what that phase still owes. Nothing is ever paid from a hold
// that is gone.

/** A phase's milestones must all fall due within this many days of the phase starting.
 * One day short of PayPal's 29, so a payment confirmed on the due day still lands. */
export const HOLD_SPAN_DAYS = 28;
/** The longest delivery window a tender can ask for. */
export const MAX_DELIVERY_DAYS = 180;

export interface PlannedMilestone {
  name: string;
  pct: number;
  /** Days after the award when the step is expected. */
  dueDay: number;
  phase: number;
}

/** Milestones for a delivery window. Up to 28 days: the usual three steps, one phase.
 * Longer: production checkpoints are added so no two steps are more than 28 days apart,
 * and the 40% between the first and last step is spread over them. */
export function planMilestones(windowDays: number): PlannedMilestone[] {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > MAX_DELIVERY_DAYS) {
    throw new Error(`Delivery must be 1 to ${MAX_DELIVERY_DAYS} days, got ${windowDays}.`);
  }
  const count = Math.max(3, Math.ceil(windowDays / HOLD_SPAN_DAYS));
  const middle = count - 2;
  const names = [
    "Production started",
    ...Array.from({ length: middle - 1 }, (_, i) => `Production checkpoint ${i + 1}`),
    "Shipped with tracking",
    "Delivered and confirmed",
  ];
  const pcts = [30, ...splitEvenly(40, middle), 30];
  const dueDays = names.map((_, i) => Math.max(1, Math.round((windowDays * (i + 1)) / count)));
  const phases = assignPhases(dueDays);
  return names.map((name, i) => ({ name, pct: pcts[i], dueDay: dueDays[i], phase: phases[i] }));
}

/** 40 over 3 is [13, 13, 14]: whole percents that sum exactly, the remainder last. */
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? total - base * (parts - 1) : base));
}

/** Groups steps into phases, greedily: a phase starts when the one before it is paid
 * (at its last step's due day) and takes every following step due within 28 days. */
export function assignPhases(dueDays: readonly number[]): number[] {
  let phase = 1;
  let start = 0;
  let previous = 0;
  return dueDays.map((due) => {
    if (due - start > HOLD_SPAN_DAYS) {
      phase += 1;
      start = previous;
    }
    previous = due;
    return phase;
  });
}

export const phaseCount = (milestones: readonly { phase: number }[]) => Math.max(1, ...milestones.map((m) => m.phase));

// ── What happens next ────────────────────────────────────────────────────────

export interface MilestoneState {
  phase: number;
  plannedCents: number;
  paid: boolean;
}

export interface HoldState {
  phase: number;
  /** Null until the buyer approved it on PayPal. */
  paypalAuthId: string | null;
  status: string;
  expiresAt: Date | null;
}

/** Hold statuses after which nothing more can be captured. */
const DEAD = new Set(["VOIDED", "EXPIRED", "CAPTURED", "DENIED"]);

/** A hold that can still pay: approved, not closed by PayPal or by our final capture,
 * and not past its expiry, even if PayPal's webhook has not said so yet. */
export function isLive(h: HoldState, now = new Date()): boolean {
  return !!h.paypalAuthId && !DEAD.has(h.status) && (!h.expiresAt || h.expiresAt.getTime() > now.getTime());
}

export type NextStep =
  | { kind: "done" }
  | { kind: "pay"; index: number; phase: number }
  /** The buyer must approve a hold before the step can be paid. `replacing` when an
   * earlier hold for the same phase lapsed or was closed with money still owed. */
  | { kind: "hold"; index: number; phase: number; amountCents: number; replacing: boolean };

export function nextStep(milestones: readonly MilestoneState[], holds: readonly HoldState[], now = new Date()): NextStep {
  const index = milestones.findIndex((m) => !m.paid);
  if (index === -1) return { kind: "done" };
  const phase = milestones[index].phase;
  const mine = holds.filter((h) => h.phase === phase);
  if (mine.some((h) => isLive(h, now))) return { kind: "pay", index, phase };
  return {
    kind: "hold",
    index,
    phase,
    amountCents: owedInPhase(milestones, phase),
    replacing: mine.some((h) => h.paypalAuthId !== null),
  };
}

/** What a phase still owes: its steps not yet paid, at their planned amounts. */
export function owedInPhase(milestones: readonly MilestoneState[], phase: number): number {
  return milestones.filter((m) => m.phase === phase && !m.paid).reduce((s, m) => s + m.plannedCents, 0);
}

/** The step that closes its phase's hold with `final_capture`. */
export function isLastOfPhase(milestones: readonly { phase: number }[], index: number): boolean {
  return index === milestones.length - 1 || milestones[index + 1].phase !== milestones[index].phase;
}
