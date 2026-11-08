"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page from the server every few seconds while the tab is visible, so a
 * log watched during a demo shows agents bidding and PayPal events as they land.
 * Polling, not a stream: it survives Cloud Run scaling to zero and needs no open connection. */
export function LiveRefresh({ seconds = 4 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
