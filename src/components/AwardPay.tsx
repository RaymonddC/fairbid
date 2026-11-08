"use client";

import Link from "next/link";
import { useState } from "react";
import { authorizeAwardAction, payMilestoneAction, startAwardAction } from "@/app/actions";
import { countryName, day, moneyFor } from "@/lib/format";
import { isFailedCapture, reasonText } from "@/lib/paypal/webhook";
import { atLeast, rankBids, type AwardView, type CaptureView, type MilestoneView, type TenderView } from "@/lib/views";
import { notifySuccess } from "./ActionButton";
import { Confirm } from "./Confirm";
import { PayPalButton } from "./PayPalButton";
import { PhotoStrip } from "./Photos";
import { Panel, Pill, SectionTitle } from "./ui";

export function AwardPay({ t, chosenBidId }: { t: TenderView; chosenBidId?: string }) {
  const held = !!t.award?.authorization?.paypalAuthId;

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

/** Choose the winner and approve the hold in PayPal's window. */
function AwardStart({ t, bidId }: { t: TenderView; bidId?: string }) {
  const eur = moneyFor(t.currency);
  const hasVat = t.bids.some((b) => b.vatCents > 0);
  const ranked = rankBids(t.bids);
  const bid = t.bids.find((b) => b.id === bidId) ?? ranked[0];
  const recommended = bid.id === ranked[0].id;
  const others = t.bids.length - 1;

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
            <dt>PayPal holds for the seller</dt>
            <dd className="num">{eur(bid.holdCents)}</dd>
          </div>
          <Row label="Import duty, paid by you at import" value={eur(bid.dutyCents)} muted />
          <Row label="Broker fees, paid by you at import" value={eur(bid.feesCents)} muted />
          <Row label="Delivered cost" value={eur(bid.deliveredCents)} muted />
        </dl>
        <p className="text-xs text-muted">{hasVat ? "Import VAT is paid at the border and reclaimed in your VAT return." : "No import VAT at this destination."}</p>
      </Panel>

      <Panel className="grid content-start gap-4">
        <div className="grid gap-1">
          <h3 className="text-base">Hold {eur(bid.holdCents)} with PayPal</h3>
          <p className="text-sm text-muted">
            Log in with your PayPal buyer account in the window that opens. The money stays in your account, reserved for the seller; nothing
            is paid until you confirm a step.
          </p>
        </div>
        <PayPalButton
          currency={t.currency}
          createOrder={() => startAwardAction(t.id, bid.id)}
          onApprove={(orderId) => authorizeAwardAction(t.id, orderId)}
          successMessage={[`Hold of ${eur(bid.holdCents)} placed with PayPal`, `Bid ${bid.letter} won. Nothing is paid until you confirm a step.`]}
        />
        <p className="text-xs text-muted">
          The other {others} bid{others === 1 ? " is" : "s are"} told they did not win once the hold is in place. A PayPal hold lasts 29 days,
          so delivery is due inside it.
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

  const auth = award.authorization!;
  const holdGone = !award.complete && (auth.status === "VOIDED" || auth.status === "EXPIRED");
  const next = holdGone ? undefined : award.milestones.find((m) => !paidOf(m));
  const remaining = award.holdCents - award.paidCents;
  const onHold = award.complete || holdGone ? 0 : remaining;
  const lastValue = finalAmount ?? remaining;
  const first = award.sellerName;

  return (
    <div className="grid gap-6">
      {holdGone && (
        <Panel className="fade-in grid gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-base">The PayPal hold is gone</h2>
            <Pill tone="warn">{auth.status === "EXPIRED" ? "Hold ran out" : "Hold cancelled"}</Pill>
          </div>
          <p className="text-sm text-muted">
            PayPal reported that the hold {auth.status === "EXPIRED" ? "reached its 29-day limit" : "was cancelled"}. {eur(remaining)} went back to
            your account on its own; what was already paid to {first} stays paid. Nothing more can be paid from this hold.
          </p>
        </Panel>
      )}
      {award.complete && (
        <Panel className="fade-in grid gap-5" featured>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 className="text-xl">Tender complete: the best delivered offer won</h2>
              <p className="text-sm text-muted">Every step was paid through PayPal after you confirmed it.</p>
            </div>
            <Pill tone="ok">Paid in full</Pill>
          </div>
          <dl className="grid overflow-hidden rounded-lg ring-1 ring-line sm:grid-cols-3 sm:divide-x sm:divide-line">
            <Stat label="Saved against the lowest quote" value={eur(t.savedCents ?? 0)} strong />
            <Stat label={`Paid to ${first}`} value={eur(award.paidCents)} />
            <Stat label="Released, never charged" value={eur(award.releasedCents)} />
          </dl>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-6">
          <Panel className="grid gap-4" featured={!award.complete}>
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
                const current = next?.id === m.id;
                const isLast = i === award.milestones.length - 1;
                const paid = paidOf(m);
                const waiting = paid?.status === "PENDING";
                const refused = m.capture && !paid ? m.capture : null;
                const amount = paid ? paid.amountCents : current && isLast ? lastValue : m.plannedCents;
                return (
                  <li
                    key={m.id}
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
                      <span className="text-sm text-muted">{m.pct}% of the hold</span>
                      {paid && !waiting && (
                        <span className="text-xs text-ok">
                          Paid {eur(paid.amountCents)} to {first}. Capture <span className="ref">{paid.paypalCaptureId}</span>
                          {paid.final && award.releasedCents > 0 ? `. ${eur(award.releasedCents)} released, never charged.` : ""}
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
                          PayPal declined {eur(refused.amountCents)}{reasonText(refused.reason) ? `: ${reasonText(refused.reason)}` : ""}. Nothing was
                          paid; this step is open again.
                        </span>
                      )}
                      {current && isLast && (
                        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          Final payment (€)
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={remaining / 100}
                            value={Math.round(lastValue / 100)}
                            onChange={(e) => setFinalAmount(Math.min(remaining, Math.max(100, Math.round(Number(e.target.value)) * 100)))}
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
                  </li>
                );
              })}
            </ol>
            {!award.complete && !holdGone && auth.expiresAt && (
              <p className="px-1 text-sm text-muted">
                Seller can&apos;t deliver? Don&apos;t confirm the next step. Nothing more is captured, and PayPal lets the hold lapse on{" "}
                {day(auth.expiresAt)}.
              </p>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <Panel className="grid gap-4">
            <div className="grid gap-1">
              <h3 className="text-sm">Where the money is</h3>
              <p className="num text-2xl font-semibold">{eur(onHold)}</p>
              <p className="text-xs text-muted">Held on your PayPal account, payable only to {first}. FairBid never holds your money.</p>
            </div>
            <Meter hold={award.holdCents} paid={award.paidCents} onHold={onHold} released={holdGone ? remaining : award.releasedCents} fmt={eur} />
            <dl className="grid gap-2 text-sm">
              <MoneyRow label="Still held" value={eur(onHold)} dot="bg-dye/40" />
              <MoneyRow label={`Paid to ${first}`} value={eur(award.paidCents)} dot="bg-dye" />
              {award.refundedCents > 0 && <MoneyRow label={`Refunded by ${first}`} value={eur(award.refundedCents)} dot="bg-warn" />}
              <MoneyRow label="Released to you" value={eur(holdGone ? remaining : award.releasedCents)} dot="bg-faint" />
            </dl>
          </Panel>
          <Panel className="grid gap-2 text-sm">
            <h3 className="text-sm">Hold details</h3>
            <Detail label="PayPal authorization" value={auth.paypalAuthId ?? "–"} mono />
            <Detail label="Held at award" value={eur(auth.amountCents)} />
            <Detail label="Valid until" value={auth.expiresAt ? day(auth.expiresAt) : "–"} />
            <Detail label="Status" value={auth.status} />
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
                : `${pending.milestone.name}. PayPal capture ${r.captureId}.`,
            ]);
          }}
        >
          <p>
            {pending.milestone.name}. PayPal captures {eur(pending.amountCents)} from the hold and pays {award.sellerName}.
          </p>
          {pending.final && pending.amountCents < remaining && <p>{eur(remaining - pending.amountCents)} is released back to you.</p>}
          <p className="font-medium text-ink">A payment can&apos;t be taken back once it is sent.</p>
        </Confirm>
      )}
    </div>
  );
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

function Meter({
  hold,
  paid,
  onHold,
  released,
  fmt: eur,
}: {
  hold: number;
  paid: number;
  onHold: number;
  released: number;
  fmt: (cents: number) => string;
}) {
  const w = (n: number) => `${(n / hold) * 100}%`;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-canvas" role="img" aria-label={`Paid ${eur(paid)} of ${eur(hold)}`}>
      <div className="bar-seg bg-dye" style={{ width: w(paid) }} />
      <div className="bar-seg bg-dye/40" style={{ width: w(onHold) }} />
      <div className="bar-seg bg-faint" style={{ width: w(released) }} />
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
