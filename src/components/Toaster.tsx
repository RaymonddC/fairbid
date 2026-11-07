"use client";

import { Toaster as Sonner } from "sonner";

/** Success and failure notices for every action that changes something. Styled with
 * the app's tokens, so it follows light and dark mode. Errors stay longer. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      duration={4500}
      toastOptions={{
        style: {
          background: "var(--surface)",
          color: "var(--ink)",
          border: "1px solid var(--line-strong)",
          boxShadow: "var(--card-shadow)",
          fontFamily: "var(--font-body), system-ui, sans-serif",
        },
        classNames: {
          description: "!text-[var(--muted)]",
          success: "[&_[data-icon]]:!text-[var(--ok)]",
          error: "!border-[var(--flag)] [&_[data-icon]]:!text-[var(--flag)]",
        },
      }}
    />
  );
}
