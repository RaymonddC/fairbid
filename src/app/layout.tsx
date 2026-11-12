import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "@/components/Toaster";
import { TopNav } from "@/components/TopNav";
import { getUser } from "@/lib/session";
import "./globals.css";

// A tender is a document: a print serif for headings, a technical sans for the work, its mono for references.
const body = IBM_Plex_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600"] });
const code = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin"], weight: ["400", "500"] });
const display = Newsreader({ variable: "--font-serif", subsets: ["latin"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: "FairBid",
  description: "Fair cross-border tenders. The best delivered offer wins, and PayPal pays only on delivery.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading headers makes every page dynamic. Next only adds the CSP nonce to its
  // scripts on dynamic renders, and a static page's scripts would be blocked.
  await headers();
  const user = await getUser();
  return (
    <html lang="en" data-theme="dark" style={{ colorScheme: "dark" }} className={`${body.variable} ${code.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full">
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-surface px-4 py-2 text-sm font-medium text-ink ring-1 ring-line focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
        >
          Skip to content
        </a>
        <TopNav user={user} />
        <div className="relative min-w-0">
          <main id="main" tabIndex={-1} className="relative z-[1] mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 outline-none sm:px-8 lg:pt-10">
            {children}
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
