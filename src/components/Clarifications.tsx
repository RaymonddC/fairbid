"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { scoreAction } from "@/app/actions";
import { dayTime } from "@/lib/format";
import { atLeast, type TenderView } from "@/lib/views";
import { ActionButton } from "./ActionButton";
import { AskQuestion } from "./AskQuestion";
import { Panel, linkButton } from "./ui";

export function Clarifications({ t }: { t: TenderView }) {
  const router = useRouter();

  if (t.sealed) {
    return (
      <Panel className="grid justify-items-start gap-2">
        <h2 className="text-base">The AI review starts when bidding closes</h2>
        <p className="text-sm text-muted">Every bid is checked against your request at once, so no bidder gets an early hint.</p>
        <Link href={`/tender/${t.id}`} className="text-sm font-medium text-dye underline underline-offset-4">
          Go to sealed bids
        </Link>
      </Panel>
    );
  }

  const scored = atLeast(t.status, "SCORED");
  // Questions stay open until a winner is chosen.
  const canAsk = !atLeast(t.status, "AWARDED");
  const askBids = t.bids.map((b) => ({ id: b.id, letter: b.letter }));

  return (
    <div className="grid max-w-[860px] gap-6">
      {/* One column: each question, the bidders' answers by letter, and who has yet to answer. */}
      {t.clarifications.length === 0 ? (
        <Panel className="grid content-start gap-1">
          <h2 className="text-base">No questions</h2>
          <p className="text-sm text-muted">
            {!canAsk
              ? "A winner was chosen without questions."
              : scored
                ? "The bids were scored without questions. You can still ask before you choose a winner."
                : "Your AI found nothing missing in the bids. Ask the bidders yourself if something is unclear."}
          </p>
        </Panel>
      ) : (
        <ol className="grid gap-4">
          {t.clarifications.map((c) => (
            <li key={c.id}>
              <Panel className="grid gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base">{c.topic}</h2>
                  <span className="text-xs text-muted">
                    To bid{c.sentTo.length > 1 ? "s" : ""} {c.sentTo.join(", ")}, {dayTime(c.sentAt)}
                  </span>
                </div>
                <p className="text-sm">{c.question}</p>
                <dl className="grid border-t border-line text-sm">
                  {c.replies.map((r) => (
                    <div key={r.letter} className="grid gap-x-4 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 sm:grid-cols-[64px_minmax(0,1fr)_auto]">
                      <dt className="font-medium">Bid {r.letter}</dt>
                      <dd className="whitespace-pre-wrap text-muted">{r.body}</dd>
                      <dd className="text-xs text-faint">{dayTime(r.at)}</dd>
                    </div>
                  ))}
                  {c.waiting.length > 0 && (
                    <div className="py-2.5 text-sm text-warn">
                      Waiting for bid{c.waiting.length > 1 ? "s" : ""} {c.waiting.join(" and ")}. An answer never changes a price.
                    </div>
                  )}
                </dl>
              </Panel>
            </li>
          ))}
        </ol>
      )}

      {canAsk && (
        <details className="notice group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium hover:bg-raised">
            Ask bidders another question
            <span className="text-faint transition-transform group-open:rotate-180" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="border-t border-line p-5">
            <AskQuestion tenderId={t.id} bids={askBids} scored={scored} />
          </div>
        </details>
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
