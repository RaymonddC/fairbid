"use client";

// An inline script that runs once, while the browser parses the server HTML (before
// first paint). When the layout re-renders in the browser (after switching account),
// React would warn about a <script> tag it never runs; rendering it as text/plain on
// the client avoids that. See node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
export function InlineScript({ html, nonce }: { html: string; nonce?: string }) {
  return (
    <script
      nonce={nonce}
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
