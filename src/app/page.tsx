import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";
import { signOutAction } from "./login/actions";

export default async function QuestBoard() {
  const user = await getUser();
  if (!user) redirect("/login");

  const tenders = await db.tender.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { bids: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Quest board</h1>
        <form action={signOutAction} className="text-sm" style={{ color: "var(--muted)" }}>
          {user.name} ·{" "}
          <button type="submit" className="underline">
            Sign out
          </button>
        </form>
      </header>
      <ul className="flex flex-col gap-3">
        {tenders.map((tender) => (
          <li key={tender.id}>
            <Link
              href={`/tender/${tender.id}`}
              className="block rounded-lg border p-4"
              style={{ background: "var(--surface)", borderColor: "var(--line)" }}
            >
              <span className="font-semibold">{tender.title}</span>
              <span className="block text-sm" style={{ color: "var(--muted)" }}>
                {tender.status} · {tender._count.bids} sealed bids
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
