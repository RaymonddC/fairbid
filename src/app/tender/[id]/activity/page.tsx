import { notFound, redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Panel } from "@/components/ui";
import { verifyChain } from "@/lib/audit";
import { getEvents } from "@/lib/audit-store";
import { tenderView } from "@/lib/cached";
import { dayTime, moneyFor } from "@/lib/format";
import { reasonText } from "@/lib/paypal/webhook";
import { getUser } from "@/lib/session";

export const metadata = { title: "Activity · FairBid" };

type Payload = Record<string, unknown>;

/** Plain words for each event the log records. Sealed prices never appear here:
 * a bid event carries only its hash. */
function describe(
  kind: string,
  p: Payload,
  letterOf: (bidId: unknown) => string,
  eur: (cents: number) => string,
): { title: string; detail?: string } {
  const money = (v: unknown) => (typeof v === "number" ? eur(v) : "");
  switch (kind) {
    case "tender.published":
      return { title: "Tender published", detail: "Criteria and weights are fixed from here on." };
    case "bid.sealed":
      return { title: "A bid was sealed", detail: `Fingerprint ${String(p.sealedHash ?? "").slice(0, 12)}…, the price stays hidden.` };
    case "tender.closed":
      return {
        title: p.early ? "The tender owner closed bidding early, every bid opened at once" : "Bidding closed, every bid opened at once",
        detail: p.early && typeof p.scheduledClose === "string" ? `The published deadline was ${dayTime(p.scheduledClose)}.` : undefined,
      };
    case "review.flagged":
      return { title: "Two bids flagged as possibly coordinated", detail: "A person decides; a flag never removes a bid." };
    case "clarification.sent":
      return { title: `${p.count ?? ""} questions sent to bidders`, detail: "Replies cannot change a price." };
    case "clarification.asked": {
      const asked = Array.isArray(p.bids) ? (p.bids as unknown[]).map(letterOf) : [];
      return { title: `You asked bid${asked.length > 1 ? "s" : ""} ${asked.join(", ")} a question`, detail: "The same question to each; replies cannot change a price." };
    }
    case "clarification.replied":
      return {
        title: `Bid ${letterOf(p.bidId)} replied to a question`,
        detail: p.channel === "telegram" ? "Answered from Telegram." : p.channel === "whatsapp" ? "Answered from WhatsApp." : undefined,
      };
    case "question.asked":
      return {
        title: "A bidder asked a question",
        detail: `“${String(p.question ?? "").slice(0, 160)}” Who asked stays hidden, and the answer goes to every bidder.`,
      };
    case "question.answered":
      return {
        title: p.answeredBy === "buyer" ? "You answered a bidder's question, for every bidder" : "Your AI answered a bidder's question from the tender",
        detail: `${String(p.answer ?? "").slice(0, 200)}${p.answeredBy === "buyer" ? "" : " An answer never changes the tender's terms."}`,
      };
    case "tender.scored":
      return {
        title: "Bids priced at delivered cost and scored",
        detail:
          p.judgedBy === "model"
            ? "Cost, lead time and completeness scored by code; the judged criteria scored blind by the AI."
            : p.judgedBy === "mixed"
              ? "Cost, lead time and completeness scored by code; the judged criteria partly by the AI, partly from scripted scores."
              : p.judgedBy === "fixture"
                ? "Cost, lead time and completeness scored by code; the judged criteria from scripted scores (no AI key)."
                : "Scored by code.",
      };
    case "review.completed": {
      const q = (p.questions ?? {}) as { count?: number; source?: string };
      return {
        title: "AI review finished",
        detail: `${q.count ?? 0} question${q.count === 1 ? "" : "s"} for bidders, ${q.source === "model" ? "written by the AI" : "scripted"}. Code decides prices and flags; questions cannot change a price.`,
      };
    }
    case "award.started": {
      const deposit = p.deposit as { cents?: number } | undefined;
      return {
        title: `Bid ${letterOf(p.bidId)} chosen, PayPal order created`,
        detail:
          (Number(p.phases ?? 1) > 1
            ? `Order of ${money(p.holdCents)}, paid in ${String(p.phases)} phases. Hold of ${money(p.firstHoldCents)} for phase 1 waiting for approval.`
            : `Hold of ${money(p.holdCents)} waiting for approval.`) +
          (deposit ? ` The tender owner agreed that the first payment, ${money(deposit.cents)}, is a non-refundable deposit.` : ""),
      };
    }
    case "award.authorized":
      return {
        title: `PayPal placed the ${Number(p.phases ?? 1) > 1 ? "phase 1 " : ""}hold: ${money(p.amountCents)}`,
        detail: `Authorization ${String(p.paypalAuthId ?? "")}`,
      };
    case "milestone.paid":
      return {
        title: `${String(p.milestone ?? "Payment")}: ${money(p.amountCents)} paid${p.finalCapture ? ", final" : ""}`,
        detail: `Capture ${String(p.paypalCaptureId ?? "")}${p.releasedCents ? `. ${money(p.releasedCents)} released, never charged.` : ""}${
          p.status === "PENDING" ? ` PayPal is holding it: ${reasonText(String(p.reason ?? "")) ?? "it completes on its own"}.` : ""
        }`,
      };
    case "tender.cancelled":
      return { title: "Bidding closed with no bids", detail: "Nothing to compare or award. Nobody was charged anything." };
    case "hold.started":
      return {
        title: p.replacing
          ? `New hold requested for phase ${String(p.phase ?? "")}: ${money(p.amountCents)}`
          : `Hold requested for phase ${String(p.phase ?? "")} of ${String(p.phases ?? "")}: ${money(p.amountCents)}`,
        detail: `PayPal order ${String(p.paypalOrderId ?? "")}, waiting for the tender owner's approval`,
      };
    case "hold.authorized":
      return {
        title: `PayPal placed the phase ${String(p.phase ?? "")} hold: ${money(p.amountCents)}`,
        detail: `Authorization ${String(p.paypalAuthId ?? "")}`,
      };
    case "hold.declined":
      return {
        title: `PayPal declined the ${p.phase && Number(p.phase) > 1 ? `phase ${String(p.phase)} ` : ""}hold: ${money(p.amountCents)}`,
        detail: `Nothing was reserved (${String(p.issue ?? "declined")}). The bidder should not start this phase until a hold is in place.`,
      };
    case "order.ended":
      return {
        title: "The tender owner ended the order between phases",
        detail: `${money(p.paidCents)} paid stays paid; ${money(p.neverChargedCents)} was never held and is never charged.`,
      };
    case "milestone.declined":
      return {
        title: `${String(p.milestone ?? "Payment")}: PayPal declined ${money(p.amountCents)}`,
        detail: `Nothing was paid${p.reason ? `: ${reasonText(String(p.reason))}` : ""}. The step stays open.`,
      };
    // Reported by PayPal's webhook, not written by FairBid.
    case "paypal.order.approved":
      return { title: "PayPal: the tender owner approved the hold in the PayPal window", detail: `Order ${String(p.paypalOrderId ?? "")}` };
    case "paypal.hold.confirmed":
      return { title: `PayPal confirmed the hold: ${money(p.amountCents)}`, detail: `Authorization ${String(p.paypalAuthId ?? "")}, status ${String(p.status ?? "")}` };
    case "paypal.hold.released":
      return {
        title: p.phase && Number(p.phase) > 1 ? `PayPal released the phase ${String(p.phase)} hold` : "PayPal released the hold",
        detail: `${p.status === "EXPIRED" ? "It reached its 29-day limit. " : ""}${
          p.unusedCents ? `${money(p.unusedCents)} unused went back to the tender owner. ` : ""
        }Nothing more can be paid from it.`,
      };
    case "paypal.payment.completed":
      return { title: `PayPal confirmed the payment: ${money(p.amountCents)}`, detail: `${String(p.milestone ?? "")}. Capture ${String(p.paypalCaptureId ?? "")}` };
    case "paypal.payment.pending":
      return {
        title: `PayPal is holding a payment: ${money(p.amountCents)}`,
        detail: `${String(p.milestone ?? "")}: ${reasonText(String(p.reason ?? "")) ?? "it completes on its own"}. Capture ${String(p.paypalCaptureId ?? "")}`,
      };
    case "paypal.payment.denied":
      return {
        title: `PayPal denied a payment: ${money(p.amountCents)}`,
        detail: `${String(p.milestone ?? "")}${p.reason ? `: ${reasonText(String(p.reason))}` : ""}. Nothing was paid; the step is open again.`,
      };
    case "paypal.payment.refunded":
      return { title: `The bidder refunded ${money(p.amountCents)} on PayPal`, detail: `${String(p.milestone ?? "")}. Refund ${String(p.refundId ?? "")}` };
    case "paypal.payment.reversed":
      return { title: `PayPal reversed a payment: ${money(p.amountCents)}`, detail: `${String(p.milestone ?? "")}. Capture ${String(p.paypalCaptureId ?? "")}` };
    // A bidder's FairBid agent. Its reasons are for the bidder: the tender owner sees only what happened.
    case "agent.bid":
      return { title: "A bidder's FairBid agent sealed the bid above", detail: "Bid from the bidder's own description of what they make, under the same rules as any bid." };
    case "agent.skipped":
      return { title: "A bidder's FairBid agent looked and did not bid" };
    case "agent.answered":
      return { title: `A bidder's FairBid agent answered for bid ${letterOf(p.bidId)}`, detail: "From the bidder's own description; an answer cannot change a price." };
    case "agent.deferred":
      return { title: "A bidder's FairBid agent left a question for the bidder to answer" };
    // Who asked stays hidden: the question itself is the "A bidder asked a question" line.
    case "agent.asked":
      return { title: "A bidder's agent asked a question", detail: "The question and its answer go to every bidder, without who asked." };
    case "agent.rechecked":
      return {
        title: p.outcome === "replaced" ? "A bidder's agent read an answer and replaced its sealed bid" : "A bidder's agent read an answer",
        detail: "The price stays hidden until bidding closes.",
      };
    // The bidder's summary is for the bidder: it names the questions their agent asked, so it stays out of view here.
    case "agent.summary":
      return { title: "A bidder's agent summed up its work for its bidder" };
    case "owner.summary":
      return { title: "Your AI summed up bidders' questions", detail: String(p.summary ?? "").slice(0, 400) };
    default:
      return { title: kind };
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  const { id } = await params;
  if (!user) redirect("/login");
  if (user.role !== "buyer") redirect(`/tender/${id}`);
  const t = await tenderView(id);
  if (!t || t.buyerId !== user.id) notFound();

  const events = await getEvents(id);
  const check = verifyChain(events);
  const letters = new Map(t.bids.map((b) => [b.id, b.letter]));
  const letterOf = (bidId: unknown) => letters.get(String(bidId)) ?? "?";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Panel className="grid content-start gap-4">
        <LiveRefresh />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base">Everything that happened, in order</h2>
          <span className="text-xs text-muted">Updates live</span>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          // A ruled ledger: one numbered line per entry, its time, what happened, and the hash that seals it.
          <ol className="grid border-t border-line-strong">
            {events.map((e) => {
              const d = describe(e.kind, (e.payload ?? {}) as Payload, letterOf, moneyFor(t.currency));
              return (
                <li
                  key={e.seq}
                  className="grid gap-x-4 gap-y-0.5 border-b border-line py-3 sm:grid-cols-[36px_104px_minmax(0,1fr)_auto] sm:items-baseline"
                >
                  <span className="ref text-xs text-faint">#{e.seq}</span>
                  <time className="text-xs text-muted" dateTime={e.at}>
                    {dayTime(e.at)}
                  </time>
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{d.title}</span>
                    {d.detail && <span className="text-sm text-muted">{d.detail}</span>}
                    {e.actor.startsWith("agent:") && (
                      <span className="text-xs text-dye">{e.kind.startsWith("agent.") ? "By a bidder's FairBid agent" : "By a bidder's AI agent"}</span>
                    )}
                    {e.actor === "paypal" && <span className="text-xs text-dye">Reported by PayPal&apos;s webhook, not written by FairBid</span>}
                  </span>
                  <span className="ref grid text-[11px] text-faint sm:text-right">
                    {/* An agent's actor names its bidder: shown as "agent" so a question cannot be traced to who asked. */}
                    <span>{e.actor.startsWith("agent:") ? "agent" : e.actor}</span>
                    <span>{e.hash.slice(0, 10)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <aside className="grid content-start gap-4">
        <Panel className="grid gap-2">
          <h3 className="text-sm">Tamper check</h3>
          {check.intact ? (
            <p className="text-sm font-medium text-ok">Chain intact, {events.length} events</p>
          ) : (
            <p className="text-sm font-medium text-flag">Broken at event #{check.firstBrokenSeq}</p>
          )}
          <p className="text-sm text-muted">
            Each event&apos;s hash covers its content and the one before it, so changing or removing any event breaks every hash after it.
            Checked just now, on the server.
          </p>
        </Panel>
      </aside>
    </div>
  );
}
