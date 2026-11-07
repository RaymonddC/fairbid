import { AuthPage } from "@/components/AuthPage";
import { safeNext } from "@/lib/safe-next";

export const metadata = { title: "Create account · FairBid" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthPage initial="register" next={safeNext((await searchParams).next)} />;
}
