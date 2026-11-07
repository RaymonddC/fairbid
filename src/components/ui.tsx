import type { ReactNode } from "react";
import { Spinner } from "./Loading";

type Tone = "ok" | "warn" | "flag" | "dye" | "sun" | "plain";

const tones: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  flag: "bg-flag-soft text-flag",
  dye: "bg-dye-soft text-dye",
  sun: "bg-sun-soft text-warn",
  plain: "bg-canvas text-muted ring-1 ring-inset ring-line",
};

const dots: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  flag: "bg-flag",
  dye: "bg-dye",
  sun: "bg-sun",
  plain: "bg-faint",
};

/** Status label. `dot` adds a small leading dot, used for live states (open, waiting, held). */
export function Pill({ tone = "plain", dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A bordered surface. `featured` adds a thin indigo line on top: reserved for the recommended or winning bid. */
export function Panel({ children, className = "", featured = false }: { children: ReactNode; className?: string; featured?: boolean }) {
  const pad = /\bp-0\b/.test(className) ? "" : "p-5";
  return <section className={`notice relative rounded-xl ${featured ? "accent-edge" : ""} ${pad} ${className}`}>{children}</section>;
}

/** Section heading inside a page: quiet, left aligned, with optional context on the right. */
export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="text-base">
        {children}
      </h2>
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  );
}

const base =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45";

const looks = {
  primary: "bg-dye text-canvas shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)] enabled:hover:bg-dye-hover",
  // "gold" is the older name for the primary action; both are the indigo accent now.
  gold: "bg-dye text-canvas shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)] enabled:hover:bg-dye-hover",
  secondary: "border border-line-strong bg-surface text-ink enabled:hover:bg-canvas",
  danger: "border border-line-strong bg-surface text-flag enabled:hover:border-flag/50 enabled:hover:bg-flag-soft",
};

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  loading = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof looks;
  disabled?: boolean;
  /** Shows a spinner and blocks clicks while a request (for example a PayPal capture) is running. */
  loading?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} aria-busy={loading} className={`${base} ${looks[variant]} ${className}`}>
      {loading && <Spinner size={15} label="Working" />}
      {children}
    </button>
  );
}

/** Link styles that match Button, for navigation that should look like an action. */
export const linkButton = {
  gold: `${base} ${looks.primary}`,
  primary: `${base} ${looks.primary}`,
  secondary: `${base} ${looks.secondary}`,
};

export function Flag({ country }: { country: "ID" | "VN" | "DE" }) {
  const name = { ID: "Indonesia", VN: "Vietnam", DE: "Germany" }[country];
  return <span className="text-xs text-muted">{name}</span>;
}
