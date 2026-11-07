import { notFound, redirect } from "next/navigation";
import { SealedBids } from "@/components/SealedBids";
import { SellerBid } from "@/components/SellerBid";
import { sellerTenderView, tenderView } from "@/lib/cached";
import { getUser } from "@/lib/session";

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const { id } = await params;

  if (user.role === "seller") {
    const view = await sellerTenderView(id, user.sellerId!);
    if (!view) notFound();
    return <SellerBid t={view} sellerName={user.name} />;
  }

  const t = await tenderView(id);
  if (!t) notFound();
  return <SealedBids t={t} />;
}
