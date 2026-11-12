"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { runAgentNowAction, saveAgentBriefAction } from "@/app/actions";
import type { AgentActivity } from "@/lib/agents/own-agent";
import { dayTime } from "@/lib/format";
import { notifyError, notifySuccess } from "./ActionButton";
import { Button, Panel, Pill } from "./ui";

const PLACEHOLDER =
  "Hand-stamped cotton batik napkins, 40 x 40 cm, about €7.50 each. Ships from Yogyakarta in about 3 weeks, shipping around €250 to Europe.";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** FairBid's own agent for a seller: they say what they make, and it bids for them. The
 * MCP key for a seller's own outside agent (`keys`) sits behind a disclosure below. */
export function OwnAgent({
  brief: savedBrief,
  on: savedOn,
  activity,
  keys,
}: {
  brief: string;
  on: boolean;
  activity: AgentActivity[];
  keys: ReactNode;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState(savedBrief);
  const [on, setOn] = useState(savedOn);
  const [pending, start] = useTransition();
  const [running, startRun] = useTransition();
  const changed = brief.trim() !== savedBrief.trim() || on !== savedOn;

  const save = () =>
    start(async () => {
      const r = await saveAgentBriefAction(brief, on);
      if (!r.ok) return notifyError(r.error);
      notifySuccess(on ? "Saved. Your agent is looking at open tenders now." : "Saved. Your agent will not bid for you.");
      // The agent works after the response: read its results back as they land.
      if (on) for (const ms of [4_000, 10_000, 20_000]) setTimeout(() => router.refresh(), ms);
    });

  const runNow = () =>
    startRun(async () => {
      const r = await runAgentNowAction();
      if (!r.ok) return notifyError(r.error);
      const did = [r.bids && `${plural(r.bids, "bid")} sealed`, r.asked && `asked the tender owner ${plural(r.asked, "question")}`, r.answers && `${plural(r.answers, "question")} answered`, r.skipped && `${r.skipped} skipped`].filter(Boolean);
      notifySuccess(did.length ? `Your agent: ${did.join(", ")}.` : "Nothing new for your agent: it has looked at every open tender.");
    });

  return (
    <Panel className="grid content-start gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="grid gap-0.5">
          <h2 className="text-base">Let FairBid&apos;s AI agent bid for you</h2>
          <p className="text-sm text-muted">
            Say what you make, your price per piece, shipping and how long it takes. When a tender fits, your agent seals a bid from what you
            wrote, asks the tender owner when the tender leaves out something it needs (a size, a material), and answers tender owners&apos; questions your description covers. It never bids on what you do not make, and an answer never changes a
            price.
          </p>
        </div>
        <Pill tone={savedOn && savedBrief ? "ok" : "plain"} dot={savedOn && Boolean(savedBrief)}>
          {savedOn && savedBrief ? "Bidding for you" : "Off"}
        </Pill>
      </div>

      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="font-medium">What do you make and sell?</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder={PLACEHOLDER}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-dye focus:ring-2 focus:ring-dye/15"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--dye)]" />
            <span className="font-medium">Bid for me automatically</span>
          </label>
          <span className="flex-1" />
          {savedOn && savedBrief && (
            <Button variant="secondary" loading={running} disabled={pending || changed} onClick={runNow}>
              Look at open tenders now
            </Button>
          )}
          <Button type="submit" loading={pending} disabled={!changed}>
            Save
          </Button>
        </div>
      </form>

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">What your agent did lately</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Once it is on, it looks at every open tender and every new one a tender owner posts.</p>
        ) : (
          <ul className="grid border-t border-line">
            {activity.map((a) => (
              <li key={a.id} className="grid gap-x-3 border-b border-line py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
                <div className="grid gap-1.5">
                  <Link href={`/tender/${a.tenderId}`} className={a.kind === "agent.summary" ? "font-medium hover:text-dye" : "hover:text-dye"}>
                    {a.text}
                  </Link>
                  {a.turns && a.turns.length > 0 && (
                    // The talk with the tender owner's AI, turn by turn: published to every bidder, without who asked.
                    <ol className="grid gap-1 border-l-2 border-line pl-3 text-xs text-muted">
                      {a.turns.map((t, i) => (
                        <li key={i} className="grid gap-0.5">
                          <span className="text-ink">Asked: {t.question}</span>
                          <span>
                            {t.answer === null
                              ? "Waiting for the tender owner."
                              : `${t.answeredBy === "buyer" ? "The tender owner" : "Their AI, from the tender"}: ${t.answer}`}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <time className="text-xs text-faint" dateTime={a.at}>
                  {dayTime(a.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="group [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-sm font-medium text-muted underline underline-offset-4 hover:text-ink">
          Use your own agent instead (Claude, etc.)
        </summary>
        <div className="mt-3">{keys}</div>
      </details>
    </Panel>
  );
}
