"use client";

import Link from "next/link";
import { closeBiddingAction, inviteAgentsAction } from "@/app/actions";
import { countryName, dayTime, moneyFor } from "@/lib/format";
import { atLeast, type BidView, type TenderView } from "@/lib/views";
import { ActionButton } from "./ActionButton";
import { PhotoStrip } from "./Photos";
import { Panel, Pill, SectionTitle, linkButton } from "./ui";

// Shared column template so the header row and the bid rows line up.
const OPEN_COLS = "sm:grid-cols-[minmax(0,1fr)_100px_140px]";

export function SealedBids({ t, agents = false, qa }: { t: TenderView; agents?: boolean; qa?: React.ReactNode }) {
  const eur = moneyFor(t.currency);
  const questions = t.clarifications.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="grid content-start gap-3" aria-labelledby="bids-title">
        <SectionTitle id="bids-title" aside={t.sealed ? `Opens ${dayTime(t.closesAt)}` : `Opened ${dayTime(t.closesAt)}`}>
          {t.sealed ? `${t.bidCount} sealed bids` : `${t.bidCount} bids, opened`}
        </SectionTitle>

        <div className="notice overflow-hidden rounded-xl">
          {t.sealed ? (
            // While sealed only the count leaves the server, so these rows carry no data.
            <ul className="divide-y divide-line">
              {Array.from({ length: t.bidCount }, (_, i) => (
                <li key={i} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="flex items-center gap-2.5 text-sm">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-canvas text-faint ring-1 ring-inset ring-line" aria-hidden="true">
                      <LockIcon />
                    </span>
                    Sealed bid {i + 1}
                  </span>
                  <Pill>Price hidden</Pill>
                </li>
              ))}
              {t.bidCount === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No bids yet. Sellers can see this tender now.</li>}
            </ul>
          ) : (
            <>
              <div className={`hidden gap-4 border-b border-line bg-canvas px-4 py-2 text-xs text-muted sm:grid ${OPEN_COLS}`} aria-hidden="true">
                <span>Bid</span>
                <span>Photos</span>
                <span className="text-right">Quoted</span>
              </div>
              <ul className="divide-y divide-line">
                {t.bids.map((b) => (
                  <li key={b.id}>
                    <OpenRow bid={b} eur={eur} tenderId={t.id} questions={t.clarifications.filter((c) => c.sentTo.includes(b.letter)).length} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <p className="text-xs text-muted">
          {t.sealed
            ? "Prices and photos stay sealed until bidding closes, so a fast reply never beats a good one."
            : "Quoted prices only. Shipping, import duty and fees come next, and they change the order."}
        </p>
        {qa}
      </section>

      <aside className="grid content-start gap-4">
        <Panel className="grid gap-3">
          {t.sealed ? (
            <>
              <h2 className="text-base">Bidding closes {dayTime(t.closesAt)}</h2>
              <p className="text-sm text-muted">Prices and photos open together at the deadline. Bidding early earns nothing.</p>
              {t.bidCount === 0 ? (
                <ActionButton
                  action={() => closeBiddingAction(t.id)}
                  variant="secondary"
                  busy="Closing…"
                  success={["Tender closed with no bids", "Nothing to compare or award, and nobody was charged."]}
                >
                  Close with no bids
                </ActionButton>
              ) : (
                <ActionButton
                  action={() => closeBiddingAction(t.id)}
                  busy="Opening the bids…"
                  success={["Bidding closed", "Every bid is open. The AI review has sent its questions to sellers."]}
                >
                  Close bidding now
                </ActionButton>
              )}
              <p className="text-xs text-faint">Closing before the deadline is allowed, and the activity log shows it with the published deadline.</p>
              {agents && (
                <ActionButton
                  action={() => inviteAgentsAction(t.id)}
                  variant="secondary"
                  busy="Seller agents are bidding…"
                  success={["Seller agents have bid", "Four seller agents read your tender over MCP and sealed their bids."]}
                >
                  Invite seller agents
                </ActionButton>
              )}
            </>
          ) : atLeast(t.status, "SCORED") ? (
            // Scored or later: the next step is forward, never back to the questions.
            <>
              <h2 className="text-base">{atLeast(t.status, "AWARDED") ? "Next: pay as the order moves" : "Next: compare delivered cost"}</h2>
              <p className="text-sm text-muted">
                {atLeast(t.status, "AWARDED")
                  ? "The winner is chosen. Confirm each step of the order to pay it from the PayPal hold."
                  : "The bids are scored. See every bid at the price delivered to your door, then award the best one."}
              </p>
              <Link href={`/tender/${t.id}/${atLeast(t.status, "AWARDED") ? "award" : "compare"}`} className={linkButton.primary}>
                {atLeast(t.status, "AWARDED") ? "Go to payments" : "Compare delivered cost"}
              </Link>
              {questions > 0 && (
                <Link
                  href={`/tender/${t.id}/review`}
                  className="inline-flex min-h-11 items-center justify-center text-sm text-muted underline underline-offset-4 hover:text-ink"
                >
                  {t.waitingReplies > 0 ? `See the questions (${t.waitingReplies} replies waiting)` : "See the questions"}
                </Link>
              )}
            </>
          ) : (
            <>
              <h2 className="text-base">Next: the AI review</h2>
              <p className="text-sm text-muted">
                Every bid was checked against your request{questions ? `, and ${questions} questions went to sellers` : ""}.{" "}
                {t.waitingReplies > 0 ? `${t.waitingReplies} replies still waiting.` : "Nothing is waiting."} Answers can&apos;t change a
                price.
              </p>
              <Link href={`/tender/${t.id}/review`} className={linkButton.primary}>
                {questions ? `See the ${questions} questions` : "See the review"}
              </Link>
              {agents && t.waitingReplies > 0 && (
                <ActionButton
                  action={() => inviteAgentsAction(t.id)}
                  variant="secondary"
                  busy="Seller agents are answering…"
                  success={["Seller agents answered", "Their replies are with the questions. No price changed."]}
                >
                  Let seller agents answer
                </ActionButton>
              )}
              <Link
                href={`/tender/${t.id}/compare`}
                className="inline-flex min-h-11 items-center justify-center text-sm text-muted underline underline-offset-4 hover:text-ink"
              >
                Skip to delivered cost
              </Link>
            </>
          )}
        </Panel>
        <div className="grid gap-1 px-1 text-sm">
          <h2 className="text-sm">Seller names stay hidden</h2>
          <p className="text-muted">Bids are scored by letter. You see who they are after you choose a winner.</p>
        </div>
      </aside>
    </div>
  );
}

function OpenRow({ bid, eur, tenderId, questions }: { bid: BidView; eur: (cents: number) => string; tenderId: string; questions: number }) {
  return (
    <article className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 ${OPEN_COLS}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <BidBadge id={bid.letter} />
        <div className="grid min-w-0 gap-0.5">
          <h3 className="text-sm">Bid {bid.letter}</h3>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {countryName(bid.country)}
            {questions > 0 && (
              <Link
                href={`/tender/${tenderId}/review`}
                className="relative font-medium text-dye underline-offset-2 hover:underline after:absolute after:-inset-x-1 after:-inset-y-3"
              >
                {questions} question{questions > 1 ? "s" : ""}
              </Link>
            )}
          </span>
        </div>
      </div>
      <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1">
        <PhotoStrip photos={bid.photos} label={`Photos in bid ${bid.letter}`} size="xs" />
      </div>
      <div className="row-span-2 grid text-right sm:row-span-1">
        <span className="num text-base font-semibold">{eur(bid.goodsCents)}</span>
        <span className="whitespace-nowrap text-xs text-faint">excl. shipping, duty</span>
      </div>
    </article>
  );
}

export function BidBadge({ id }: { id: string }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-dye-soft text-xs font-semibold text-dye" aria-hidden="true">
      {id}
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.6" fill="none" />
    </svg>
  );
}
