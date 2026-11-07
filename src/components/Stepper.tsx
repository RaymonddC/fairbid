"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type StepState = "done" | "progress" | "todo";

const STEPS = [
  { path: "", label: "Sealed bids" },
  { path: "/review", label: "Questions" },
  { path: "/compare", label: "Compare" },
  { path: "/award", label: "Award and pay" },
];

/** The four tender steps as tabs under the page header. Numbers, because the steps are a sequence. */
export function Stepper({ tenderId, state, waiting }: { tenderId: string; state: StepState[]; waiting: number }) {
  const path = usePathname();
  const base = `/tender/${tenderId}`;
  // -1 on pages outside the four steps (the activity log).
  const current = STEPS.findLastIndex((s) => (s.path ? path.startsWith(base + s.path) : path === base));
  const describe = (i: number) =>
    `Step ${i + 1}: ${STEPS[i].label}, ${state[i] === "done" ? "done" : state[i] === "progress" ? "in progress" : "not started"}`;

  return (
    <nav aria-label="Tender steps" className="-mb-px overflow-x-auto [scrollbar-width:none]">
      <ol className="flex min-w-max gap-1 sm:gap-6">
        {STEPS.map((s, i) => {
          const active = i === current;
          const st = state[i];
          return (
            <li key={s.label}>
              <Link
                href={base + s.path}
                aria-label={describe(i)}
                aria-current={active ? "step" : undefined}
                className={`flex min-h-11 items-center gap-2 border-b-2 px-1 pb-0.5 text-sm transition-colors ${
                  active ? "border-dye font-medium text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <span
                  className={`num grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${
                    st === "done" ? "bg-dye text-canvas" : active ? "bg-ink text-canvas" : "bg-canvas text-muted ring-1 ring-inset ring-line-strong"
                  }`}
                  aria-hidden="true"
                >
                  {st === "done" ? <Check /> : i + 1}
                </span>
                <span aria-hidden="true">{s.label}</span>
                {st === "progress" && (
                  <span className="num rounded-full bg-warn-soft px-1.5 text-[11px] font-medium text-warn" aria-hidden="true">
                    {waiting} waiting
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Check() {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
