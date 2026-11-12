import { notFound, redirect } from "next/navigation";
import { SealedBids } from "@/components/SealedBids";
import { SellerBid } from "@/components/SellerBid";
import { BuyerQA, SellerQA } from "@/components/TenderQA";
import { DEMO_USERS } from "@/lib/auth";
import { sellerTenderView, tenderView } from "@/lib/cached";
import { getUser } from "@/lib/session";
import { latestOwnerSummary, listTenderQuestions } from "@/lib/tender-questions";

export const metadata = { title: "Tender · FairBid" };

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const { id } = await params;

  if (user.role === "seller") {
    const view = await sellerTenderView(id, user.sellerId!);
    if (!view) notFound();
    // Sellers' questions to the buyer, published to every seller without who asked.
    const questions = await listTenderQuestions(id, user.sellerId!);
    return <SellerBid t={view} qa={<SellerQA tenderId={id} questions={questions} open={view.open} />} />;
  }

  const t = await tenderView(id);
  if (!t || t.buyerId !== user.id) notFound();
  const [questions, summary] = await Promise.all([listTenderQuestions(id), latestOwnerSummary(id)]);
  // The scripted seller agents are a demo: only the shared demo accounts can invite them.
  return (
    <SealedBids
      t={t}
      agents={DEMO_USERS.some((u) => u.id === user.id)}
      qa={<BuyerQA questions={questions} summary={summary} open={t.status === "OPEN" && new Date() < new Date(t.closesAt)} />}
    />
  );
}
