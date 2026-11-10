"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type StepState = "done" | "progress" | "todo";

// `short` is the label on a phone, so all four steps fit across 375px without scrolling.
const STEPS = [
  { path: "", label: "Sealed bids", short: "Bids" },
  { path: "/review", label: "Questions", short: "Questions" },
  { path: "/compare", label: "Compare", short: "Compare" },
  { path: "/award", label: "Award and pay", short: "Award" },
];

/** The four tender steps as tabs under the page header. Numbers, because the steps are a sequence. */
export function Stepper({ tenderId, state, waiting }: { tenderId: string; state: StepState[]; waiting: number }) {
  const path = usePathname();
  const base = `/tender/${tenderId}`;
  // -1 on pages outside the four steps (the activity log).
  const current = STEPS.findLastIndex((s) => (s.path ? path.startsWith(base + s.path) : path === base));
  const describe = (i: number) =>
    `Step ${i + 1}: ${STEPS[i].label}, ${state[i] === "done" ? "done" : state[i] === "progress" ? `${waiting} replies waiting` : "not started"}`;

  return (
    <nav aria-label="Tender steps" className="-mb-px overflow-x-auto [scrollbar-width:none]">
      <ol className="flex min-w-max gap-0.5 sm:gap-6">
        {STEPS.map((s, i) => {
          const active = i === current;
          const st = state[i];
          return (
            <li key={s.label}>
              <Link
                href={base + s.path}
                aria-label={describe(i)}
                aria-current={active ? "step" : undefined}
                className={`flex min-h-11 items-center gap-1.5 border-b-2 px-0.5 pb-0.5 text-sm transition-colors sm:gap-2 sm:px-1 ${
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
                <span aria-hidden="true">
                  <span className="sm:hidden">{s.short}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </span>
                {st === "progress" && (
                  // On a phone the open step's unticked number says enough; the chip would push "Award" off screen.
                  <span className="num hidden rounded-full bg-warn-soft px-1.5 text-[11px] font-medium text-warn sm:inline" aria-hidden="true">
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
