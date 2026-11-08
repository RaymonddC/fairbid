"use client";

import Link from "next/link";
import { useState } from "react";
import { authorizeAwardAction, endOrderAction, payMilestoneAction, startAwardAction, startHoldAction } from "@/app/actions";
import { countryName, day, moneyFor } from "@/lib/format";
import { HOLD_SPAN_DAYS, phaseCount, planMilestones } from "@/lib/phases";
import { isFailedCapture, reasonText } from "@/lib/paypal/webhook";
import { milestoneAmounts } from "@/lib/tender";
import { atLeast, rankBids, type AwardView, type CaptureView, type HoldView, type MilestoneView, type TenderView } from "@/lib/views";
import { notifySuccess } from "./ActionButton";
import { Confirm } from "./Confirm";
import { PayPalButton } from "./PayPalButton";
import { PhotoStrip } from "./Photos";
import { Panel, Pill, SectionTitle } from "./ui";

export function AwardPay({ t, chosenBidId }: { t: TenderView; chosenBidId?: string }) {
  const held = (t.award?.holds.length ?? 0) > 0;

  if (!held) {
    if (t.status !== "SCORED") {
      return (
        <Panel className="grid justify-items-start gap-2">
          <h2 className="text-base">No winner yet</h2>
          <p className="text-sm text-muted">Compare the bids at delivered cost, then award one. PayPal holds the money from that moment.</p>
          <Link href={`/tender/${t.id}/compare`} className="text-sm font-medium text-dye underline underline-offset-4">
            Go to compare
          </Link>
        </Panel>
      );
    }
    return <AwardStart t={t} bidId={chosenBidId} />;
  }
  return <Payments t={t} award={t.award!} />;
}

/** The holds an order of this length is paid in, for a given order total. */
function phasePlan(deliveryDays: number, totalCents: number) {
  const plan = planMilestones(Math.min(180, Math.max(1, deliveryDays)));
  const amounts = milestoneAmounts(totalCents, plan);
  const phases = phaseCount(plan);
  return Array.from({ length: phases }, (_, i) => {
    const steps = plan.map((m, j) => ({ ...m, cents: amounts[j] })).filter((m) => m.phase === i + 1);
    return { phase: i + 1, cents: steps.reduce((s, m) => s + m.cents, 0), steps, startsDay: i === 0 ? 0 : plan.filter((m) => m.phase === i).at(-1)!.dueDay };
  });
}

/** Choose the winner and approve the first hold in PayPal's window. */
function AwardStart({ t, bidId }: { t: TenderView; bidId?: string }) {
  const eur = moneyFor(t.currency);
  const hasVat = t.bids.some((b) => b.vatCents > 0);
  const ranked = rankBids(t.bids);
  const bid = t.bids.find((b) => b.id === bidId) ?? ranked[0];
  const recommended = bid.id === ranked[0].id;
  const others = t.bids.length - 1;
  const phases = phasePlan(t.spec.deliveryDays, bid.holdCents);
  const phased = phases.length > 1;
  const first = phases[0].cents;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel className="grid content-start gap-4" featured={recommended}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <span className="text-sm text-muted">{recommended ? "Recommended winner" : "Your choice"}</span>
            <h2 className="text-xl">Award bid {bid.letter}</h2>
            <p className="text-sm text-muted">
              {countryName(bid.country)}, {bid.leadTimeDays} days to deliver, score {(bid.total ?? 0).toFixed(1)} / 100.
            </p>
          </div>
          {bid.flagged && <Pill tone="warn">⚑ Flagged as coordinated</Pill>}
        </div>
        <PhotoStrip photos={bid.photos} label={`Photos in bid ${bid.letter}`} size="sm" />
        <dl className="grid gap-1.5 text-sm">
          <Row label="Goods" value={eur(bid.goodsCents)} />
          <Row label="Shipping to the door" value={eur(bid.shippingCents)} />
          <div className="flex justify-between border-t border-line pt-2 font-semibold">
            <dt>{phased ? "Order paid through PayPal" : "PayPal holds for the seller"}</dt>
            <dd className="num">{eur(bid.holdCents)}</dd>
          </div>
          <Row label="Import duty, paid by you at import" value={eur(bid.dutyCents)} muted />
          <Row label="Broker fees, paid by you at import" value={eur(bid.feesCents)} muted />
          <Row label="Delivered cost" value={eur(bid.deliveredCents)} muted />
        </dl>
        <p className="text-xs text-muted">{hasVat ? "Import VAT is paid at the border and reclaimed in your VAT return." : "No import VAT at this destination."}</p>
        {phased && (
          <div className="grid gap-2 border-t border-line pt-3">
            <h3 className="text-sm">Held one phase at a time</h3>
            <p className="text-xs text-muted">
              A PayPal hold lasts 29 days and cannot be extended, so this {t.spec.deliveryDays}-day order is held in {phases.length} phases. You
              approve each phase&apos;s hold in PayPal when that phase starts; the seller starts a phase once its money is held.
            </p>
            <ol className="grid gap-1 text-sm">
              {phases.map((p) => (
                <li key={p.phase} className="flex justify-between gap-3">
                  <span className="text-muted">
                    Phase {p.phase}: {p.steps.map((s) => s.name.toLowerCase()).join(", ")}
                    {p.phase > 1 ? `, from about day ${p.startsDay}` : ", now"}
                  </span>
                  <span className="num">{eur(p.cents)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Panel>

      <Panel className="grid content-start gap-4">
        <div className="grid gap-1">
          <h3 className="text-base">{phased ? `Hold phase 1: ${eur(first)}` : `Hold ${eur(bid.holdCents)} with PayPal`}</h3>
          <p className="text-sm text-muted">
            Log in with your PayPal buyer account in the window that opens. The money stays in your account, reserved for the seller; nothing
            is paid until you confirm a step.
          </p>
        </div>
        <PayPalButton
          currency={t.currency}
          createOrder={() => startAwardAction(t.id, bid.id)}
          onApprove={(orderId) => authorizeAwardAction(t.id, orderId)}
          successMessage={[
            `Hold of ${eur(first)} placed with PayPal`,
            `Bid ${bid.letter} won.${phased ? ` Phase 1 of ${phases.length} is held.` : ""} Nothing is paid until you confirm a step.`,
          ]}
        />
        <p className="text-xs text-muted">
          The other {others} bid{others === 1 ? " is" : "s are"} told they did not win once the hold is in place.
          {phased
            ? ` Each hold covers at most ${HOLD_SPAN_DAYS} days of work.`
            : " A PayPal hold lasts 29 days, so delivery is due inside it."}
        </p>
      </Panel>
    </div>
  );
}

type Pending = { milestone: MilestoneView; amountCents: number; final: boolean };

/** The capture that paid this step, if PayPal accepted one. A declined or denied capture paid nothing. */
const paidOf = (m: MilestoneView): CaptureView | null => (m.capture && !isFailedCapture(m.capture.status) ? m.capture : null);

function Payments({ t, award }: { t: TenderView; award: AwardView }) {
  const eur = moneyFor(t.currency);
  const [finalAmount, setFinalAmount] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ending, setEnding] = useState(false);

  const next = award.next;
  const phased = award.phases > 1;
  const hold = award.authorization;
  const holdLeft = hold && hold.live ? hold.amountCents - hold.usedCents : 0;
  const lastValue = finalAmount ?? holdLeft;
  const first = award.sellerName;
  const lastId = award.milestones.at(-1)?.id;
  const needsHold = next.kind === "hold" ? next : null;

  return (
    <div className="grid gap-6">
      {award.complete && (
        <Panel className="fade-in grid gap-5" featured>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 className="text-xl">{award.endedAt ? "Order ended early" : "Tender complete: the best delivered offer won"}</h2>
              <p className="text-sm text-muted">
                {award.endedAt
                  ? `You ended the order on ${day(award.endedAt)}, between phases, with no hold in place. What was paid stays paid; the rest was never charged.`
                  : "Every step was paid through PayPal after you confirmed it."}
              </p>
            </div>
            <Pill tone={award.endedAt ? "plain" : "ok"}>{award.endedAt ? "Ended" : "Paid in full"}</Pill>
          </div>
          <dl className="grid overflow-hidden rounded-lg ring-1 ring-line sm:grid-cols-3 sm:divide-x sm:divide-line">
            <Stat label="Saved against the lowest quote" value={eur(t.savedCents ?? 0)} strong />
            <Stat label={`Paid to ${first}`} value={eur(award.paidCents)} />
            <Stat label={award.endedAt ? "Never charged" : "Released, never charged"} value={eur(award.releasedCents)} />
          </dl>
        </Panel>
      )}

      {needsHold && (
        <Panel className="fade-in grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" featured>
          <div className="grid content-start gap-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-base">
                {needsHold.replacing ? `The hold for phase ${needsHold.phase} has lapsed` : `Phase ${needsHold.phase} of ${award.phases} is next`}
              </h2>
              <Pill tone="warn">{needsHold.replacing ? "Needs a new hold" : "Not held yet"}</Pill>
            </div>
            <p className="text-sm text-muted">
              {needsHold.replacing
                ? `PayPal holds last 29 days, and this one ran out before its steps were paid. The unused money went back to your account on its own. Place a new hold of ${eur(needsHold.amountCents)} so ${first} can be paid for this phase.`
                : `The steps before are paid. Hold ${eur(needsHold.amountCents)} for phase ${needsHold.phase} when it starts; ${first} starts the phase once the money is held, and nothing is paid until you confirm a step.`}
            </p>
            <button
              type="button"
              onClick={() => setEnding(true)}
              className="justify-self-start text-sm font-medium text-muted underline underline-offset-4 hover:text-ink"
            >
              End the order here instead
            </button>
          </div>
          <div className="grid content-start gap-2">
            <PayPalButton
              currency={t.currency}
              createOrder={() => startHoldAction(t.id)}
              onApprove={(orderId) => authorizeAwardAction(t.id, orderId)}
              successMessage={[`Hold of ${eur(needsHold.amountCents)} placed with PayPal`, `Phase ${needsHold.phase} is held. ${first} can start it.`]}
            />
          </div>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-6">
          <Panel className="grid gap-4" featured={!award.complete && !needsHold}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-sm text-muted">Bid {award.letter} won. The seller is</span>
                <h2 className="text-xl">{award.sellerName}</h2>
                <p className="text-sm text-muted">
                  {countryName(award.sellerCountry)}. Paid to PayPal account <span className="ref">{award.payeeEmail}</span>.
                </p>
              </div>
              <Pill tone="ok">Real hold, PayPal sandbox</Pill>
            </div>
            <PhotoStrip photos={award.photos} label={`Photos from ${award.sellerName}`} size="sm" />
            <p className="text-xs text-muted">Check each step against these photos before you pay it.</p>
          </Panel>

          <section className="grid gap-3" aria-labelledby="pay-title">
            <SectionTitle id="pay-title" aside="Nothing moves until you confirm a step">
              Pay as the order moves
            </SectionTitle>
            <ol className="notice divide-y divide-line overflow-hidden rounded-xl">
              {award.milestones.map((m, i) => {
                const current = next.kind === "pay" && next.milestoneId === m.id;
                const isLast = m.id === lastId;
                const paid = paidOf(m);
                const waiting = paid?.status === "PENDING";
                const refused = m.capture && !paid ? m.capture : null;
                const amount = paid ? paid.amountCents : current && isLast ? lastValue : m.plannedCents;
                const newPhase = phased && (i === 0 || award.milestones[i - 1].phase !== m.phase);
                return (
                  <li key={m.id} className="grid">
                    {newPhase && <PhaseHeader phase={m.phase} phases={award.phases} holds={award.holds} next={next} eur={eur} />}
                    <div
                      className={`grid grid-cols-[auto_1fr] items-start gap-x-3.5 gap-y-3 px-4 py-4 sm:grid-cols-[auto_1fr_auto] ${current ? "bg-dye-soft/40" : ""}`}
                    >
                      <span
                        className={`num mt-0.5 grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                          paid
                            ? waiting
                              ? "bg-warn text-canvas"
                              : "bg-ok text-canvas"
                            : current
                              ? "bg-dye text-canvas"
                              : "bg-canvas text-muted ring-1 ring-inset ring-line-strong"
                        }`}
                        aria-hidden="true"
                      >
                        {paid ? (waiting ? "…" : "✓") : i + 1}
                      </span>
                      <div className="grid gap-0.5">
                        <span className="text-sm font-medium">
                          {m.name}
                          <span className="sr-only">{paid ? (waiting ? ", pending at PayPal" : ", paid") : current ? ", next" : ""}</span>
                        </span>
                        <span className="text-sm text-muted">
                          {m.pct}% of the order{!paid && m.dueAt ? `, due about ${day(m.dueAt)}` : ""}
                        </span>
                        {paid && !waiting && (
                          <span className="text-xs text-ok">
                            Paid {eur(paid.amountCents)} to {first}. Capture <span className="ref">{paid.paypalCaptureId}</span>
                            {isLast && award.releasedCents > 0 ? `. ${eur(award.releasedCents)} released, never charged.` : ""}
                          </span>
                        )}
                        {paid && waiting && (
                          <span className="text-xs text-warn">
                            PayPal is holding {eur(paid.amountCents)} for {first}: {reasonText(paid.reason) ?? "it completes on its own"}. Capture{" "}
                            <span className="ref">{paid.paypalCaptureId}</span>. This page updates when PayPal reports back.
                          </span>
                        )}
                        {paid && paid.refundedCents > 0 && (
                          <span className="text-xs text-warn">
                            {first} refunded {eur(paid.refundedCents)} from their own PayPal account, reported by PayPal.
                          </span>
                        )}
                        {refused && (
                          <span className="text-xs text-flag">
                            PayPal declined {eur(refused.amountCents)}
                            {reasonText(refused.reason) ? `: ${reasonText(refused.reason)}` : ""}. Nothing was paid; this step is open again.
                          </span>
                        )}
                        {current && isLast && (
                          <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                            Final payment (€)
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={holdLeft / 100}
                              value={Math.round(lastValue / 100)}
                              onChange={(e) => setFinalAmount(Math.min(holdLeft, Math.max(100, Math.round(Number(e.target.value)) * 100)))}
                              className="num min-h-10 w-28 rounded-lg border border-line-strong bg-surface px-2 text-right outline-none focus:border-dye"
                            />
                            <span className="text-xs text-muted">Pay less if something is missing. The rest is released to you.</span>
                          </label>
                        )}
                      </div>
                      <div className="col-start-2 grid justify-items-start gap-2 sm:col-start-3 sm:justify-items-end">
                        <span className="num text-sm font-semibold">{eur(amount)}</span>
                        {current && (
                          <button
                            type="button"
                            onClick={() => setPending({ milestone: m, amountCents: isLast ? lastValue : m.plannedCents, final: isLast })}
                            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-dye px-3.5 text-sm font-medium text-canvas hover:bg-dye-hover"
                          >
                            {isLast ? `Confirm delivery and pay ${eur(lastValue)}` : `Pay ${eur(m.plannedCents)}`}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {next.kind === "pay" && hold?.expiresAt && (
              <p className="px-1 text-sm text-muted">
                Seller can&apos;t deliver? Don&apos;t confirm the next step. Nothing more is captured, and PayPal lets the hold lapse on{" "}
                {day(hold.expiresAt)}.
              </p>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <Panel className="grid gap-4">
            <div className="grid gap-1">
              <h3 className="text-sm">Where the money is</h3>
              <p className="num text-2xl font-semibold">{eur(award.heldCents)}</p>
              <p className="text-xs text-muted">Held on your PayPal account, payable only to {first}. FairBid never holds your money.</p>
            </div>
            <Meter
              total={award.holdCents}
              parts={[
                { cents: award.paidCents, className: "bg-dye" },
                { cents: award.heldCents, className: "bg-dye/40" },
                { cents: award.notYetHeldCents, className: "bg-sun/60" },
                { cents: award.releasedCents, className: "bg-faint" },
              ]}
              label={`Paid ${eur(award.paidCents)} of ${eur(award.holdCents)}`}
            />
            <dl className="grid gap-2 text-sm">
              <MoneyRow label="Still held" value={eur(award.heldCents)} dot="bg-dye/40" />
              <MoneyRow label={`Paid to ${first}`} value={eur(award.paidCents)} dot="bg-dye" />
              {award.notYetHeldCents > 0 && <MoneyRow label="Later phases, not held yet" value={eur(award.notYetHeldCents)} dot="bg-sun/60" />}
              {award.refundedCents > 0 && <MoneyRow label={`Refunded by ${first}`} value={eur(award.refundedCents)} dot="bg-warn" />}
              <MoneyRow label={award.endedAt ? "Never charged" : "Released to you"} value={eur(award.releasedCents)} dot="bg-faint" />
            </dl>
          </Panel>
          <Panel className="grid gap-3 text-sm">
            <h3 className="text-sm">{award.holds.length > 1 ? "PayPal holds" : "Hold details"}</h3>
            {award.holds.map((h) => (
              <div key={h.id} className="grid gap-1.5 border-t border-line pt-2 first-of-type:border-t-0 first-of-type:pt-0">
                {award.holds.length > 1 && (
                  <span className="text-xs font-medium text-muted">
                    Phase {h.phase}
                    {award.holds.filter((x) => x.phase === h.phase).length > 1 ? `, hold ${h.seq}` : ""}
                  </span>
                )}
                <Detail label="PayPal authorization" value={h.paypalAuthId ?? "–"} mono />
                <Detail label="Held" value={eur(h.amountCents)} />
                <Detail label="Valid until" value={h.expiresAt ? day(h.expiresAt) : "–"} />
                <Detail label="Status" value={holdStatus(h)} />
              </div>
            ))}
            {atLeast(t.status, "COMPLETE") && (
              <div className="pt-1">
                <Pill tone="ok">Tender complete</Pill>
              </div>
            )}
          </Panel>
        </aside>
      </div>

      {pending && (
        <Confirm
          title={`Send ${eur(pending.amountCents)} to ${first}?`}
          confirmLabel={`Send ${eur(pending.amountCents)}`}
          busyLabel="Capturing with PayPal…"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const r = await payMilestoneAction(t.id, pending.milestone.id, pending.amountCents);
            if (!r.ok) throw new Error(r.error);
            notifySuccess([
              `${eur(pending.amountCents)} sent to ${award.sellerName}`,
              r.final
                ? `Tender complete.${r.releasedCents ? ` ${eur(r.releasedCents)} released back to you.` : ""} Capture ${r.captureId}.`
                : r.phaseDone
                  ? `Phase ${pending.milestone.phase} is paid. Hold the next phase when it starts. Capture ${r.captureId}.`
                  : `${pending.milestone.name}. PayPal capture ${r.captureId}.`,
            ]);
          }}
        >
          <p>
            {pending.milestone.name}. PayPal captures {eur(pending.amountCents)} from the hold and pays {award.sellerName}.
          </p>
          {pending.final && pending.amountCents < holdLeft && <p>{eur(holdLeft - pending.amountCents)} is released back to you.</p>}
          <p className="font-medium text-ink">A payment can&apos;t be taken back once it is sent.</p>
        </Confirm>
      )}

      {ending && (
        <Confirm
          title="End the order here?"
          confirmLabel="End the order"
          busyLabel="Ending…"
          onClose={() => setEnding(false)}
          onConfirm={async () => {
            const r = await endOrderAction(t.id);
            if (!r.ok) throw new Error(r.error);
            notifySuccess(["Order ended", `${eur(r.neverChargedCents)} was never held and is never charged.`]);
          }}
        >
          <p>
            Nothing is held now, so ending costs nothing more: {eur(award.paidCents)} already paid to {first} stays paid, and{" "}
            {eur(award.holdCents - award.paidCents)} is never charged.
          </p>
          <p className="font-medium text-ink">Tell {first} first: they should not start work that no hold covers. This can&apos;t be undone.</p>
        </Confirm>
      )}
    </div>
  );
}

/** A phase's label in the step list, with whether its money is held. */
function PhaseHeader({
  phase,
  phases,
  holds,
  next,
  eur,
}: {
  phase: number;
  phases: number;
  holds: HoldView[];
  next: AwardView["next"];
  eur: (cents: number) => string;
}) {
  const live = holds.find((h) => h.phase === phase && h.live);
  const closed = holds.some((h) => h.phase === phase && h.status === "CAPTURED");
  const later = next.kind !== "done" && phase > next.phase;
  const label = live
    ? `held, ${eur(live.amountCents - live.usedCents)} left until ${live.expiresAt ? new Date(live.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–"}`
    : closed
      ? "paid"
      : later
        ? "held when it starts"
        : "not held";
  return (
    <div className="flex items-baseline justify-between gap-3 bg-canvas px-4 py-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted">
        Phase {phase} of {phases}
      </span>
      <span className={live ? "text-ok" : closed ? "text-muted" : "text-warn"}>{label}</span>
    </div>
  );
}

function holdStatus(h: HoldView): string {
  if (h.status === "CAPTURED") return "Closed by the final capture";
  if (h.status === "EXPIRED" || (!h.live && h.expiresAt && new Date(h.expiresAt) <= new Date())) return "Lapsed";
  if (h.status === "VOIDED") return "Released by PayPal";
  return h.status === "CREATED" ? "Held" : h.status;
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted" : ""}`}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid gap-0.5 border-t border-line bg-surface px-4 py-3 first:border-t-0 sm:border-t-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num text-xl font-semibold ${strong ? "text-ok" : ""}`}>{value}</dd>
    </div>
  );
}

function Meter({ total, parts, label }: { total: number; parts: { cents: number; className: string }[]; label: string }) {
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-canvas" role="img" aria-label={label}>
      {parts.map((p, i) => (
        <div key={i} className={`bar-seg ${p.className}`} style={{ width: `${total > 0 ? (p.cents / total) * 100 : 0}%` }} />
      ))}
    </div>
  );
}

function MoneyRow({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-2 text-muted">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted">{label}</span>
      <span className={`truncate font-medium ${mono ? "ref" : "num"}`}>{value}</span>
    </div>
  );
}
