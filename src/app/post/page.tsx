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
        description="Tell your AI what you need. It drafts the tender and asks what is missing; nothing goes out until you publish."
      />
      <PostTender />
    </>
  );
}
