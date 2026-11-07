import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FairBid",
  description: "Fair cross-border tenders. The best delivered offer wins, and PayPal pays only on delivery.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading headers makes every page dynamic. Next only adds the CSP nonce to its
  // scripts on dynamic renders, and a static page's scripts would be blocked.
  await headers();
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
