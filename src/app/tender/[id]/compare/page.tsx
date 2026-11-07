import { notFound, redirect } from "next/navigation";
import { Compare } from "@/components/Compare";
import { tenderView } from "@/lib/cached";
import { getUser } from "@/lib/session";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  const { id } = await params;
  if (!user) redirect("/login");
  if (user.role !== "buyer") redirect(`/tender/${id}`);
  const t = await tenderView(id);
  if (!t) notFound();
  return <Compare t={t} />;
}
