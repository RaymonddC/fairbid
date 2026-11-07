"use client";

import { useEffect, useSyncExternalStore } from "react";

type Pref = "light" | "dark" | "system";
const KEY = "fairbid-theme";
const listeners = new Set<() => void>();

function readPref(): Pref {
  const p = document.documentElement.getAttribute("data-theme-pref");
  return p === "light" || p === "dark" ? p : "system";
}

function apply(pref: Pref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-theme-pref", pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const options: { value: Pref; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
  { value: "system", label: "System", icon: <MonitorIcon /> },
];

/** Light, dark or follow the system. The choice is saved and applied before paint by the script in layout.tsx. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // The server does not know the saved theme; it renders "system" and the client corrects it after hydration.
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as Pref);

  // Follow the operating system while the preference is "system".
  useEffect(() => {
    if (pref !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return (
    <div
      className={`grid grid-cols-3 gap-0.5 rounded-full bg-canvas p-0.5 ring-1 ring-inset ring-line ${compact ? "w-[92px]" : ""}`}
      role="group"
      aria-label="Theme"
    >
      {options.map((o) => {
        const on = pref === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => apply(o.value)}
            aria-pressed={on}
            aria-label={compact ? `${o.label} theme` : undefined}
            title={`${o.label} theme`}
            className={`flex min-h-7 items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-colors ${
              on ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-line" : "text-muted hover:text-ink"
            } ${compact ? "" : "px-2"}`}
          >
            {o.icon}
            {!compact && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z" strokeLinejoin="round" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" />
      <path d="M5.5 14h5M8 11v3" strokeLinecap="round" />
    </svg>
  );
}
