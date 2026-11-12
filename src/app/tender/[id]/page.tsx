import { notFound, redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { SealedBids } from "@/components/SealedBids";
import { SellerBid } from "@/components/SellerBid";
import { BuyerQA, SellerQA } from "@/components/TenderQA";
import { DEMO_TENDER_ID } from "../../../../prisma/seed-data";
import { keysBySellerFromEnv } from "@/lib/agents/bots";
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
    return <SellerBid t={view} qa={<SellerQA key="qa" tenderId={id} questions={questions} open={view.open} />} />;
  }

  const t = await tenderView(id);
  if (!t || t.buyerId !== user.id) notFound();
  const [questions, summary] = await Promise.all([listTenderQuestions(id), latestOwnerSummary(id)]);
  // The scripted bidder agents work demo owners' tenders on their own (demo-schedule.ts). The line saying so shows
  // only where they run: a demo owner with keys set; the demo tender already has its four bids, so only answers there.
  const agents = DEMO_USERS.some((u) => u.id === user.id) && keysBySellerFromEnv(process.env.MCP_SELLER_KEYS).size > 0;
  const mode = agents ? (id === DEMO_TENDER_ID ? "answer" : "all") : false;
  // While the agents work, the page re-reads itself so sealed bids and replies appear as they land.
  const live = (mode === "all" && t.status === "OPEN") || (mode !== false && t.waitingReplies > 0);
  return (
    <>
      {live && <LiveRefresh seconds={5} />}
      <SealedBids
        t={t}
        agents={mode}
        qa={<BuyerQA key="qa" questions={questions} summary={summary} open={t.status === "OPEN" && new Date() < new Date(t.closesAt)} />}
      />
    </>
  );
}
