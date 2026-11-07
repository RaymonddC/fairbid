import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";
import { isSealed, type TenderStatus } from "@/lib/tender";

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const tender = await db.tender.findUnique({
    where: { id },
    include: {
      criteria: { orderBy: { weightPct: "desc" } },
      _count: { select: { bids: true } },
    },
  });
  if (!tender) notFound();

  const sealed = isSealed(tender.status as TenderStatus);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">{tender.title}</h1>
        <p className="mt-2" style={{ color: "var(--muted)" }}>
          {tender.needText}
        </p>
      </div>
      <section>
        <h2 className="font-semibold">Published criteria</h2>
        <ul className="mt-2 text-sm">
          {tender.criteria.map((criterion) => (
            <li key={criterion.id}>
              {criterion.name}, {criterion.weightPct}%
            </li>
          ))}
        </ul>
      </section>
      {sealed ? (
        <p className="rounded-lg border p-4" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
          {tender._count.bids} sealed bids received. They open together when the tender closes.
        </p>
      ) : null}
    </div>
  );
}
