"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { scoreAction, simulateReplyAction } from "@/app/actions";
import { dayTime } from "@/lib/format";
import { atLeast, type TenderView } from "@/lib/views";
import { ActionButton } from "./ActionButton";
import { AskQuestion } from "./AskQuestion";
import { Panel, Pill, SectionTitle, linkButton } from "./ui";

export function Clarifications({ t }: { t: TenderView }) {
  const router = useRouter();
  const [open, setOpen] = useState(t.clarifications[0]?.id ?? "");

  if (t.sealed) {
    return (
      <Panel className="grid justify-items-start gap-2">
        <h2 className="text-base">The AI review starts when bidding closes</h2>
        <p className="text-sm text-muted">Every bid is checked against your request at once, so no seller gets an early hint.</p>
        <Link href={`/tender/${t.id}`} className="text-sm font-medium text-dye underline underline-offset-4">
          Go to sealed bids
        </Link>
      </Panel>
    );
  }

  const q = t.clarifications.find((c) => c.id === open) ?? t.clarifications[0];
  const scored = atLeast(t.status, "SCORED");
  // Questions stay open until a winner is chosen.
  const canAsk = !atLeast(t.status, "AWARDED");
  const askBids = t.bids.map((b) => ({ id: b.id, letter: b.letter }));
  const asked = new Set(t.clarifications.flatMap((c) => c.sentTo));
  const clean = t.bids.filter((b) => !asked.has(b.letter)).map((b) => `bid ${b.letter}`);
  const bidIdOf = (letter: string) => t.bids.find((b) => b.letter === letter)?.id ?? "";

  return (
    <div className="grid gap-6">
      {t.clarifications.length === 0 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel className="grid content-start gap-1">
            <h2 className="text-base">No questions yet</h2>
            <p className="text-sm text-muted">
              {!canAsk
                ? "A winner was chosen without questions."
                : scored
                ? "The bids were scored without questions. You can still ask before you choose a winner."
                : "The review found nothing missing. If something is unclear to you, ask the sellers before you score the bids."}
            </p>
          </Panel>
          {canAsk && <AskQuestion tenderId={t.id} bids={askBids} scored={scored} />}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="grid content-start gap-3" aria-labelledby="q-title">
            <SectionTitle id="q-title">Questions to sellers</SectionTitle>
            <p className="text-sm text-muted">
              Each bid was checked against your request. When something is missing, the same question goes to every seller it applies to.
            </p>
            <ul className="notice divide-y divide-line overflow-hidden rounded-xl">
              {t.clarifications.map((c) => {
                const selected = q?.id === c.id;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setOpen(c.id)}
                      aria-pressed={selected}
                      className={`grid w-full gap-0.5 border-l-2 px-4 py-3 text-left transition-colors ${
                        selected ? "border-dye bg-dye-soft/50" : "border-transparent hover:bg-canvas"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{c.topic}</span>
                        {c.waiting.length === 0 ? (
                          <Pill tone="ok">Answered</Pill>
                        ) : (
                          <Pill tone="warn" dot>
                            Waiting
                          </Pill>
                        )}
                      </span>
                      <span className="text-xs text-muted">Asked bid{c.sentTo.length > 1 ? "s" : ""} {c.sentTo.join(", ")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted">{clean.length ? `Nothing missing in ${clean.join(", ")}.` : "Every bid had something to clear up."}</p>
            {canAsk && <AskQuestion tenderId={t.id} bids={askBids} scored={scored} />}
          </section>

          {q && (
            <Panel className="grid content-start gap-4 p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="grid gap-0.5">
                  <h2 className="text-base">{q.topic}</h2>
                  <p className="text-sm text-muted">Sent to bid{q.sentTo.length > 1 ? "s" : ""} {q.sentTo.join(", ")}. Replies cannot change a price.</p>
                </div>
                <Pill>Price locked</Pill>
              </div>

              <div className="grid gap-3 px-5" aria-live="polite">
                <Bubble side="out" who="FairBid" at={dayTime(q.sentAt)}>
                  {q.question}
                </Bubble>
                {q.replies.map((r) => (
                  <Bubble key={r.letter} side="in" who={`Bid ${r.letter}`} at={dayTime(r.at)}>
                    {r.body}
                  </Bubble>
                ))}
                {q.waiting.length > 0 && (
                  <p className="py-1 text-center text-xs text-muted">Waiting for bid {q.waiting.join(" and ")}.</p>
                )}
              </div>

              <div className="grid gap-3 px-5 pb-5">
                {q.waiting.length > 0 && (
                  <div className="flex flex-wrap items-start gap-2 border-t border-dashed border-line pt-3 text-sm">
                    <span className="pt-2.5 text-xs text-faint">Demo</span>
                    {q.waiting.map((letter) => (
                      <ActionButton
                        key={letter}
                        variant="secondary"
                        action={() => simulateReplyAction(q.id, bidIdOf(letter))}
                        busy="Sending…"
                        success={`Bid ${letter} replied`}
                      >
                        Simulate reply from bid {letter}
                      </ActionButton>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-surface px-5 py-4 ring-1 ring-line">
        <p className="text-sm text-muted">
          {scored
            ? "The bids are scored. See what each one really costs delivered."
            : t.waitingReplies > 0
              ? `${t.waitingReplies} ${t.waitingReplies === 1 ? "reply" : "replies"} still waiting. You can score now; a late reply is still kept with the bid.`
              : "Every question is answered. Next, price every bid at delivered cost and score it."}
        </p>
        {scored ? (
          <Link href={`/tender/${t.id}/compare`} className={linkButton.primary}>
            Compare delivered cost
          </Link>
        ) : (
          <ActionButton
            busy="Pricing and scoring…"
            success={["Bids scored", "Every bid is priced at delivered cost, with a reason for each score."]}
            action={async () => {
              const r = await scoreAction(t.id);
              if (r.ok) router.push(`/tender/${t.id}/compare`);
              return r;
            }}
          >
            Score the bids and compare
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function Bubble({ side, who, at, children }: { side: "in" | "out"; who: string; at: string; children: React.ReactNode }) {
  return (
    <div className={`flex ${side === "out" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${side === "out" ? "rounded-br-md bg-dye text-canvas" : "rounded-bl-md bg-canvas text-ink"}`}>
        <div className={`mb-0.5 text-xs font-medium ${side === "out" ? "text-canvas/75" : "text-muted"}`}>{who}</div>
        <p className="whitespace-pre-wrap">{children}</p>
        <div className={`mt-1 text-right text-[11px] ${side === "out" ? "text-canvas/65" : "text-faint"}`}>{at}</div>
      </div>
    </div>
  );
}
