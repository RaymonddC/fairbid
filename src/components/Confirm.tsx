"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui";

/**
 * Confirmation before money moves. Says what happens, to whom, and whether it can be undone.
 * The confirm button shows a spinner while the PayPal call runs; Esc or Cancel closes it.
 * onConfirm may return "leave" when it navigates away (to PayPal), so the dialog stays busy; a thrown error is shown in the dialog.
 */
export function Confirm({
  title,
  children,
  confirmLabel,
  busyLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void | "leave"> | void | "leave";
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={onClose}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(92vw,440px)] rounded-xl bg-surface p-0 text-ink shadow-2xl ring-1 ring-line backdrop:bg-black/60"
    >
      <div className="grid gap-4 p-6">
        <h2 id="confirm-title" className="text-lg">
          {title}
        </h2>
        <div className="grid gap-2 text-sm text-muted">{children}</div>
        {error && (
          <p role="alert" className="rounded-lg bg-flag/10 p-3 text-sm text-flag">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => ref.current?.close()} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "gold"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                if ((await onConfirm()) === "leave") return;
              } catch (e) {
                setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
                setBusy(false);
                return;
              }
              setBusy(false);
              ref.current?.close();
            }}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
