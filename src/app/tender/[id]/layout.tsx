import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { linkButton } from "@/components/ui";
import type { ReactNode } from "react";
import { Meta, PageHeader } from "@/components/PageHeader";
import { ResetDemo } from "@/components/ResetDemo";
import { StatusPill } from "@/components/StatusPill";
import { Stepper } from "@/components/Stepper";
import { tenderView } from "@/lib/cached";
import { day, moneyFor } from "@/lib/format";
import { getUser } from "@/lib/session";
import { deliverBy } from "@/lib/tender-data";
import { atLeast } from "@/lib/views";
import { DEMO_TENDER_ID } from "../../../../prisma/seed-data";

export default async function TenderLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // Sellers get their own page (the bid form) without the buyer's steps.
  if (user.role === "seller") return children;

  const t = await tenderView(id);
  if (!t || t.buyerId !== user.id) notFound();
  const eur = moneyFor(t.currency);
  const photo = t.photos[0] ?? t.bids.find((b) => b.photos.length)?.photos[0];
  // Warn when a hold is close to expiry with money still unpaid: after it, PayPal cannot capture.
  const auth = t.award?.authorization;
  const daysLeft = t.award?.holdDaysLeft ?? null;
  const expiring =
    auth?.live && auth.expiresAt && daysLeft !== null && daysLeft <= 5 && !t.award!.complete
      ? { at: auth.expiresAt, days: Math.max(0, daysLeft), leftCents: auth.amountCents - auth.usedCents }
      : null;
  // A phase waiting for its hold, or a hold that lapsed with money still owed.
  const needsHold = t.award && !t.award.complete && t.award.next.kind === "hold" ? t.award.next : null;

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/", label: "Tenders" }]}
        title={t.title}
        actions={
          <Link href={`/tender/${t.id}/activity`} className={linkButton.secondary}>
            Activity log
          </Link>
        }
        media={
          photo ? (
            <span className="hidden h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl ring-1 ring-line sm:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="" className="h-full w-full object-cover" />
            </span>
          ) : undefined
        }
        meta={
          <>
            <StatusPill status={t.status} waiting={t.waitingReplies} heldCents={t.award?.heldCents} />
            <Meta label="Budget">
              {eur(t.budgetCents)}
              {t.destinationCountry === "DE" ? " excl. VAT" : ""}
            </Meta>
            <Meta label="Deliver by">{day(deliverBy(t.closesAt, t.spec.deliveryDays))}</Meta>
            <Meta label="Terms">DAP {t.spec.deliverTo.split(",")[0] || "Berlin"}</Meta>
          </>
        }
      >
        <Stepper
          tenderId={t.id}
          state={[
            atLeast(t.status, "CLOSED") ? "done" : "todo",
            !atLeast(t.status, "CLOSED") ? "todo" : t.waitingReplies > 0 && !atLeast(t.status, "SCORED") ? "progress" : "done",
            atLeast(t.status, "AWARDED") ? "done" : "todo",
            t.status === "COMPLETE" ? "done" : "todo",
          ]}
          waiting={t.waitingReplies}
        />
      </PageHeader>
      <div className="grid gap-6">
        {expiring && (
          <p role="alert" className="notice flex flex-wrap items-center justify-between gap-3 rounded-xl border-l-4 !border-l-flag p-4 text-sm">
            <span>
              <strong className="font-medium">The PayPal hold ends {day(expiring.at)}</strong>, in {expiring.days} day{expiring.days === 1 ? "" : "s"}.{" "}
              {eur(expiring.leftCents)} is still unpaid from it. After that date it can no longer be captured; you can place a new hold then.
            </span>
            <Link href={`/tender/${t.id}/award`} className="font-medium text-dye underline underline-offset-4">
              Go to payments
            </Link>
          </p>
        )}
        {needsHold && (
          <p role="status" className="notice flex flex-wrap items-center justify-between gap-3 rounded-xl border-l-4 !border-l-warn p-4 text-sm">
            <span>
              <strong className="font-medium">
                {needsHold.replacing ? `The hold for phase ${needsHold.phase} lapsed.` : `Phase ${needsHold.phase} is not held yet.`}
              </strong>{" "}
              Hold {eur(needsHold.amountCents)} with PayPal so the seller can be paid for it.
            </span>
            <Link href={`/tender/${t.id}/award`} className="font-medium text-dye underline underline-offset-4">
              Go to payments
            </Link>
          </p>
        )}
        {children}
        {t.id === DEMO_TENDER_ID && <ResetDemo />}
      </div>
    </>
  );
}
