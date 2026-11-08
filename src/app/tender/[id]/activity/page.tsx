import { notFound, redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Panel, Pill } from "@/components/ui";
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
      return { title: "Bidding closed, every bid opened at once" };
    case "review.flagged":
      return { title: "Two bids flagged as possibly coordinated", detail: "A person decides; a flag never removes a bid." };
    case "clarification.sent":
      return { title: `${p.count ?? ""} questions sent to sellers`, detail: "Replies cannot change a price." };
    case "clarification.asked": {
      const asked = Array.isArray(p.bids) ? (p.bids as unknown[]).map(letterOf) : [];
      return { title: `You asked bid${asked.length > 1 ? "s" : ""} ${asked.join(", ")} a question`, detail: "The same question to each; replies cannot change a price." };
    }
    case "clarification.replied":
      return { title: `Bid ${letterOf(p.bidId)} replied to a question` };
    case "tender.scored":
      return {
        title: "Bids priced at delivered cost and scored",
        detail: p.judgedBy === "model" ? "Judged criteria scored blind by the AI." : p.judgedBy === "fixture" ? "Judged criteria from scripted scores (no AI key)." : undefined,
      };
    case "review.completed": {
      const q = (p.questions ?? {}) as { count?: number; source?: string };
      return {
        title: "AI review finished",
        detail: `${q.count ?? 0} question${q.count === 1 ? "" : "s"} for sellers, ${q.source === "model" ? "written by the AI" : "scripted"}. Code decides prices and flags; the AI only writes.`,
      };
    }
    case "award.started":
      return { title: `Bid ${letterOf(p.bidId)} chosen, PayPal order created`, detail: `Hold of ${money(p.holdCents)} waiting for approval.` };
    case "award.authorized":
      return { title: `PayPal placed the hold: ${money(p.amountCents)}`, detail: `Authorization ${String(p.paypalAuthId ?? "")}` };
    case "milestone.paid":
      return {
        title: `${String(p.milestone ?? "Payment")}: ${money(p.amountCents)} paid${p.finalCapture ? ", final" : ""}`,
        detail: `Capture ${String(p.paypalCaptureId ?? "")}${p.releasedCents ? `. ${money(p.releasedCents)} released, never charged.` : ""}${
          p.status === "PENDING" ? ` PayPal is holding it: ${reasonText(String(p.reason ?? "")) ?? "it completes on its own"}.` : ""
        }`,
      };
    case "milestone.declined":
      return {
        title: `${String(p.milestone ?? "Payment")}: PayPal declined ${money(p.amountCents)}`,
        detail: `Nothing was paid${p.reason ? `: ${reasonText(String(p.reason))}` : ""}. The step stays open.`,
      };
    // Reported by PayPal's webhook, not written by FairBid.
    case "paypal.order.approved":
      return { title: "PayPal: the buyer approved the hold in the PayPal window", detail: `Order ${String(p.paypalOrderId ?? "")}` };
    case "paypal.hold.confirmed":
      return { title: `PayPal confirmed the hold: ${money(p.amountCents)}`, detail: `Authorization ${String(p.paypalAuthId ?? "")}, status ${String(p.status ?? "")}` };
    case "paypal.hold.released":
      return {
        title: "PayPal released the hold",
        detail: p.status === "EXPIRED" ? "It reached its 29-day limit. Nothing more can be paid from it." : "Nothing more can be paid from it.",
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
      return { title: `The seller refunded ${money(p.amountCents)} on PayPal`, detail: `${String(p.milestone ?? "")}. Refund ${String(p.refundId ?? "")}` };
    case "paypal.payment.reversed":
      return { title: `PayPal reversed a payment: ${money(p.amountCents)}`, detail: `${String(p.milestone ?? "")}. Capture ${String(p.paypalCaptureId ?? "")}` };
    default:
      return { title: kind };
  }
}

const GOOD_NEWS = new Set(["award.authorized", "milestone.paid", "paypal.order.approved", "paypal.hold.confirmed", "paypal.payment.completed"]);
const tone = (kind: string) =>
  GOOD_NEWS.has(kind) ? "bg-ok" : kind.startsWith("review") || kind.startsWith("paypal.") || kind === "milestone.declined" ? "bg-warn" : "bg-dye";

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
          <Pill tone="ok" dot>
            Updates live
          </Pill>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="relative grid gap-4 border-l border-line pl-5">
            {events.map((e) => {
              const d = describe(e.kind, (e.payload ?? {}) as Payload, letterOf, moneyFor(t.currency));
              return (
                <li key={e.seq} className="relative grid gap-0.5">
                  <span className={`absolute -left-[25px] top-1.5 h-2 w-2 rounded-full ring-4 ring-surface ${tone(e.kind)}`} aria-hidden="true" />
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm font-medium">{d.title}</span>
                    <time className="text-xs text-faint" dateTime={e.at}>
                      {dayTime(e.at)}
                    </time>
                  </span>
                  {d.detail && <span className="text-sm text-muted">{d.detail}</span>}
                  {e.actor.startsWith("agent:") && <span className="text-xs text-dye">By a seller agent, over MCP</span>}
                  {e.actor === "paypal" && <span className="text-xs text-dye">Reported by PayPal&apos;s webhook, not written by FairBid</span>}
                  <span className="ref text-[11px] text-faint">
                    #{e.seq} {e.actor}, hash {e.hash.slice(0, 10)}…
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
            <Pill tone="ok">Chain intact, {events.length} events</Pill>
          ) : (
            <Pill tone="flag">Broken at event #{check.firstBrokenSeq}</Pill>
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
