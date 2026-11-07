"use client";

import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "./ui";

type Result = { ok: true } | { ok: false; error: string };

/** Runs a server action with a spinner. Success and failure show as a toast; the page
 * refreshes itself when the action succeeds. */
export function ActionButton({
  action,
  children,
  busy,
  success,
  variant = "primary",
  className = "",
  disabled = false,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  busy?: ReactNode;
  /** Toast shown when the action succeeds: a title, or a title and a description. */
  success?: string | [string, string];
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <Button
        variant={variant}
        loading={pending}
        disabled={disabled}
        onClick={() =>
          start(async () => {
            const r = await action();
            if (!r.ok) notifyError(r.error);
            else if (success) notifySuccess(success);
          })
        }
      >
        {pending && busy ? busy : children}
      </Button>
    </div>
  );
}

export function notifySuccess(message: string | [string, string]) {
  const [title, description] = Array.isArray(message) ? message : [message, undefined];
  toast.success(title, { description });
}

export function notifyError(error: string) {
  toast.error("That did not go through", { description: error, duration: 9000 });
}
