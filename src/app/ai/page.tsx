import Link from "next/link";
import { redirect } from "next/navigation";
import { ChannelLinker } from "@/components/ChannelLinker";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui";
import { aiFallbackModel, aiLocation, aiModel } from "@/lib/ai-config";
import { aiEnabled } from "@/lib/ai/model";
import { buyerChannels, buyerLinksOf } from "@/lib/channels";
import { maskAddress } from "@/lib/channels/types";
import { db } from "@/lib/db";
import { dayTime } from "@/lib/format";
import { getUser } from "@/lib/session";

export const metadata = { title: "Your agent · FairBid" };

// What the tender owner's agent does, in the order a tender meets it. Each says what decides instead.
const JOBS = [
  { job: "Drafts the tender", how: "From your own words, and asks what your request leaves open. You check every field before you publish." },
  { job: "Answers bidders' questions", how: "While bidding is open, from the tender as published. What it cannot answer from the tender waits for you." },
  { job: "Sums up for you", how: "What bidders and their agents asked on each tender, and what still waits for you. No bidder is named." },
  { job: "Writes questions for bidders", how: "After bidding closes, where a bid leaves something out. The same question goes to every bid with the gap; a reply cannot change a price." },
  { job: "Scores the judged criteria", how: "Only those code cannot measure, such as handmade proof, from 0 to 100 with a reason. It sees a letter, never a name or a price." },
  { job: "Explains collusion flags", how: "Code finds the pairs of bids that look coordinated; your agent writes why. A flag asks you to look and never removes a bid." },
];

// The log lines that record the agent's work.
const KINDS = ["question.answered", "owner.summary", "review.completed", "tender.scored"];
type Payload = Record<string, unknown>;

interface Line {
  id: string;
  at: string;
  tenderId: string;
  title: string;
  what: string;
  detail?: string;
}

function describe(kind: string, p: Payload, questions: Map<string, string>): { what: string; detail?: string } | null {
  switch (kind) {
    case "question.answered":
      // Only the agent's own answers; the owner's answers are theirs.
      if (p.answeredBy !== "ai") return null;
      return { what: `Answered a bidder's question: "${questions.get(String(p.questionId)) ?? "a question"}"`, detail: String(p.answer ?? "") };
    case "owner.summary":
      return { what: "Summed up bidders' questions", detail: String(p.summary ?? "") };
    case "review.completed": {
      const q = (p.questions ?? {}) as { count?: number; source?: string };
      const n = q.count ?? 0;
      const reasons = Array.isArray(p.flagReasons) ? (p.flagReasons as string[]) : [];
      const asked = n ? `Wrote ${n} question${n === 1 ? "" : "s"} for bidders${q.source === "model" ? "" : " (scripted, AI off)"}` : "Found nothing to ask bidders";
      return { what: `${asked}${reasons.length ? `, and explained ${reasons.length} collusion flag${reasons.length === 1 ? "" : "s"}` : ""}` };
    }
    case "tender.scored":
      if (p.judgedBy === "code") return null;
      return {
        what:
          p.judgedBy === "model"
            ? "Scored the judged criteria blind, with a reason each. Code ranked the bids."
            : "Scripted scores stood in for the judged criteria (AI off). Code ranked the bids.",
      };
    default:
      return null;
  }
}

/** The tender owner's agent in one place: what it did lately, whether it is on, what it does, and the chat it reports to. */
export default async function OwnerAgentPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "buyer") redirect("/agent");

  const on = aiEnabled();
  const [events, links] = await Promise.all([
    db.event.findMany({
      where: { kind: { in: KINDS }, tender: { buyerId: user.id } },
      orderBy: { at: "desc" },
      take: 40,
      select: { id: true, kind: true, at: true, payload: true, tenderId: true, tender: { select: { title: true } } },
    }),
    buyerLinksOf(user.id),
  ]);
  const questionIds = events.map((e) => (e.payload as Payload | null)?.questionId).filter((x): x is string => typeof x === "string");
  const questions = new Map(
    (await db.tenderQuestion.findMany({ where: { id: { in: questionIds } }, select: { id: true, question: true } })).map((q) => [q.id, q.question]),
  );
  // Newest first; only the latest summary per tender, since each one replaces the last.
  const seenSummary = new Set<string>();
  const lines: Line[] = [];
  for (const e of events) {
    if (e.kind === "owner.summary") {
      if (seenSummary.has(e.tenderId)) continue;
      seenSummary.add(e.tenderId);
    }
    const d = describe(e.kind, (e.payload ?? {}) as Payload, questions);
    if (d) lines.push({ id: e.id, at: e.at.toISOString(), tenderId: e.tenderId, title: e.tender.title, ...d });
    if (lines.length >= 12) break;
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Your agent"
        description="Your AI works on your side of every tender: it drafts, answers bidders from the tender, sums up what they ask, and scores what code cannot. Code ranks the bids; you decide."
      />

      <Panel className="grid content-start gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base">What your agent did lately</h2>
          <span className="text-xs text-muted">
            {on ? (
              <>
                <span className="font-medium text-ok">On</span>: {aiModel()} on Vertex AI ({aiLocation()}), {aiFallbackModel()} if it fails
              </>
            ) : (
              <>
                <span className="font-medium text-warn">Off</span>: scripted answers stand in, and the log says so
              </>
            )}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. It starts when you draft a tender, and when bidders ask about one.</p>
        ) : (
          <ol className="grid border-t border-line">
            {lines.map((l) => (
              <li key={l.id} className="grid gap-x-6 gap-y-0.5 border-b border-line py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                <span className="grid gap-0.5">
                  <span className="text-sm">
                    <Link href={`/tender/${l.tenderId}`} className="font-medium hover:text-dye">
                      {l.title}
                    </Link>
                    : {l.what}
                  </span>
                  {l.detail && <span className="text-sm text-muted">{l.detail}</span>}
                </span>
                <time className="text-xs text-faint" dateTime={l.at}>
                  {dayTime(l.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <ChannelLinker
        audience="buyer"
        channels={buyerChannels().map((c) => {
          const l = links.find((x) => x.kind === c.kind);
          return { ...c, linked: l ? maskAddress(c.kind, l.address) : null };
        })}
      />

      <details className="notice group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium hover:bg-raised">
          What your agent does, and what decides instead
          <span className="text-faint transition-transform group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <dl className="grid border-t border-line px-5 text-sm">
          {JOBS.map((j) => (
            <div key={j.job} className="grid gap-x-6 gap-y-0.5 border-b border-line py-3 last:border-b-0 sm:grid-cols-[220px_minmax(0,1fr)]">
              <dt className="font-medium">{j.job}</dt>
              <dd className="text-muted">{j.how}</dd>
            </div>
          ))}
          <p className="py-3 text-muted">It never moves money, never learns who bid before you award, and never picks the winner.</p>
        </dl>
      </details>
    </div>
  );
}
