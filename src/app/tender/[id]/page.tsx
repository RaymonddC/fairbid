import { notFound, redirect } from "next/navigation";
import { SealedBids } from "@/components/SealedBids";
import { SellerBid } from "@/components/SellerBid";
import { DEMO_USERS } from "@/lib/auth";
import { sellerTenderView, tenderView } from "@/lib/cached";
import { getUser } from "@/lib/session";

export const metadata = { title: "Tender · FairBid" };

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const { id } = await params;

  if (user.role === "seller") {
    const view = await sellerTenderView(id, user.sellerId!);
    if (!view) notFound();
    return <SellerBid t={view} />;
  }

  const t = await tenderView(id);
  if (!t || t.buyerId !== user.id) notFound();
  // The scripted seller agents are a demo: only the shared demo accounts can invite them.
  return <SealedBids t={t} agents={DEMO_USERS.some((u) => u.id === user.id)} />;
}
