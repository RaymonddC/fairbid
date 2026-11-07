import { notFound, redirect } from "next/navigation";
import { AwardPay } from "@/components/AwardPay";
import { tenderView } from "@/lib/cached";
import { getUser } from "@/lib/session";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ bid?: string }>;
}) {
  const user = await getUser();
  const { id } = await params;
  if (!user) redirect("/login");
  if (user.role !== "buyer") redirect(`/tender/${id}`);
  const t = await tenderView(id);
  if (!t || t.buyerId !== user.id) notFound();
  const { bid } = await searchParams;
  return <AwardPay t={t} chosenBidId={bid} />;
}
