import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui";
import { aiFallbackModel, aiLocation, aiModel } from "@/lib/ai-config";
import { aiEnabled } from "@/lib/ai/model";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";

export const metadata = { title: "AI · FairBid" };

// What the AI does for a tender owner, in the order a tender meets it. Each says what decides instead.
const JOBS = [
  { job: "Drafts the tender", how: "From your own words: item, quantity, budget, deadline and criteria. You check every field before you publish." },
  { job: "Suggests the customs code", how: "Each bid's HS code, with how sure it is. Below 70% the bidder must confirm it." },
  { job: "Writes questions for bidders", how: "After bidding closes, where a bid leaves something out. The same question goes to every bid with the gap; a reply cannot change a price." },
  { job: "Scores the judged criteria", how: "Only those code cannot measure, such as handmade proof, from 0 to 100 with a reason. It sees a letter, never a name or a price." },
  { job: "Explains collusion flags", how: "Code finds the pairs of bids that look coordinated; the AI writes why. A flag asks you to look and never removes a bid." },
];

// The log lines that record the AI's work, and how to say each one plainly.
const AI_EVENTS = ["review.completed", "review.flagged", "tender.scored"] as const;
type Payload = Record<string, unknown>;

function describe(kind: string, p: Payload): string | null {
  switch (kind) {
    case "review.completed": {
      const q = (p.questions ?? {}) as { count?: number; source?: string };
      const n = q.count ?? 0;
      const reasons = Array.isArray(p.flagReasons) ? (p.flagReasons as string[]) : [];
      const asked = n ? `Wrote ${n} question${n === 1 ? "" : "s"} for bidders${q.source === "model" ? "" : " (scripted, AI off)"}` : "Found nothing to ask bidders";
      const flags = reasons.length ? `; explained ${reasons.length} collusion flag${reasons.length === 1 ? "" : "s"}${reasons.every((r) => r === "model") ? "" : " (scripted)"}` : "";
      return `${asked}${flags}.`;
    }
    case "review.flagged":
      return null; // Code found the pair; the review line above says who explained it.
    case "tender.scored":
      return p.judgedBy === "model"
        ? "Scored the judged criteria blind. Code scored cost, lead time and completeness, and ranked the bids."
        : p.judgedBy === "mixed"
          ? "Scored some judged criteria blind; scripted scores stood in for the rest. Code ranked the bids."
          : p.judgedBy === "fixture"
            ? "Scripted scores stood in for the judged criteria (AI off). Code ranked the bids."
            : "Code scored every criterion and ranked the bids.";
    default:
      return null;
  }
}

/** One place for a tender owner to see what the AI does, whether it is on, and what it did on each tender. */
export default async function AiPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "buyer") redirect("/");

  const on = aiEnabled();
  const tenders = await db.tender.findMany({
    where: { buyerId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      events: { where: { kind: { in: [...AI_EVENTS] } }, orderBy: { seq: "asc" }, select: { seq: true, kind: true, at: true, payload: true } },
    },
  });
  const worked = tenders.filter((t) => t.events.some((e) => describe(e.kind, (e.payload ?? {}) as Payload)));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="What the AI does"
        description="Code adds up the money and ranks the bids. The AI only does what code cannot, and every step it takes is in the log."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="grid content-start gap-3">
          <h2 className="text-base">Its jobs</h2>
          <dl className="grid border-t border-line text-sm">
            {JOBS.map((j) => (
              <div key={j.job} className="grid gap-x-6 gap-y-0.5 border-b border-line py-3 last:border-b-0 sm:grid-cols-[220px_minmax(0,1fr)]">
                <dt className="font-medium">{j.job}</dt>
                <dd className="text-muted">{j.how}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">
            It never moves money, never sees who bid before you award, and never decides the winner. You do.
          </p>
        </Panel>

        <Panel className="grid content-start gap-2">
          <h2 className="text-base">Setting</h2>
          {on ? (
            <p className="text-sm">
              <span className="font-medium text-ok">On.</span> {aiModel()} on Vertex AI ({aiLocation()}), with {aiFallbackModel()} if it fails.
            </p>
          ) : (
            <p className="text-sm">
              <span className="font-medium text-warn">Off.</span> Every job answers from a scripted fixture, so the whole flow still runs, and the
              log says so.
            </p>
          )}
          <p className="text-xs text-muted">Set by the server (AI_MODEL, GOOGLE_CLOUD_PROJECT), not per tender.</p>
        </Panel>
      </div>

      <section className="grid gap-3" aria-labelledby="done-title">
        <h2 id="done-title" className="text-base">
          What it did on your tenders
        </h2>
        {worked.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. The AI starts work when a tender&apos;s bidding closes.</p>
        ) : (
          <ol className="notice grid divide-y divide-line px-5">
            {worked.map((t) => (
              <li key={t.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)_auto] sm:gap-x-6">
                <span className="font-medium">{t.title}</span>
                <ul className="grid gap-0.5 text-sm text-muted">
                  {t.events.map((e) => {
                    const line = describe(e.kind, (e.payload ?? {}) as Payload);
                    return line ? <li key={e.seq}>{line}</li> : null;
                  })}
                </ul>
                <Link href={`/tender/${t.id}/activity`} className="text-sm font-medium text-dye underline-offset-4 hover:underline">
                  Activity log
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
