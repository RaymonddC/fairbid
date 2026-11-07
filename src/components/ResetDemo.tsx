"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { resetDemoAction } from "@/app/actions";
import { notifyError, notifySuccess } from "./ActionButton";

/** Starts the demo tender over: bids sealed again, no award, no payments. */
export function ResetDemo() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3 border-t border-line pt-2 text-xs text-faint">
      <span>Demo controls</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await resetDemoAction();
            if (!r.ok) return notifyError(r.error);
            notifySuccess(["Demo reset", "Four sealed bids again, no award and no payments."]);
            router.push(r.path);
          })
        }
        className="inline-flex min-h-11 items-center text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Reset demo"}
      </button>
    </div>
  );
}
