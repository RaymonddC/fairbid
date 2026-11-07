import { PageLoading } from "@/components/Loading";

// Shown while a page's server components read the database.
export default function Loading() {
  return <PageLoading label="Loading" />;
}
