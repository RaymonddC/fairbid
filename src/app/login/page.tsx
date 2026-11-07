import { AuthPage } from "@/components/AuthPage";
import { safeNext } from "@/lib/safe-next";

export const metadata = { title: "Sign in · FairBid" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthPage initial="login" next={safeNext((await searchParams).next)} />;
}
