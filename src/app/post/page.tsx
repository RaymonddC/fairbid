import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PostTender } from "@/components/PostTender";
import { getUser } from "@/lib/session";

export const metadata = { title: "Post a tender · FairBid" };

export default async function Page() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "buyer") redirect("/");
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/", label: "Tenders" }]}
        title="Post a tender"
        description="Say what you need in your own words. Bidders bid sealed, and every bid is compared at what it costs delivered."
      />
      <PostTender />
    </>
  );
}
