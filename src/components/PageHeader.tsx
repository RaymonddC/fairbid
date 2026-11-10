import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Compact page header: optional breadcrumb, title, one line of context, actions on the right.
 * `children` sits under it (for example the tender step tabs) and shares the bottom rule.
 * With `sheet`, the header is a sheet of paper, like the tender it describes, with its `reference` in mono.
 */
export function PageHeader({
  crumbs,
  title,
  description,
  meta,
  actions,
  media,
  sheet = false,
  reference,
  children,
}: {
  crumbs?: { href: string; label: string }[];
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A small picture beside the title, such as the product being bought. */
  media?: ReactNode;
  sheet?: boolean;
  /** A short identifier shown in mono beside the breadcrumb, for a header that is a document. */
  reference?: string;
  children?: ReactNode;
}) {
  return (
    <header
      className={`mb-6 grid gap-4 ${sheet ? "notice px-5 pt-5 sm:px-7 sm:pt-6" : ""} ${children && !sheet ? "border-b border-line" : ""} ${
        children && sheet ? "" : sheet ? "pb-5" : ""
      }`}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-4">
        {media}
        <div className="grid min-w-0 gap-1.5">
          {(crumbs || reference) && (
            <div className="flex flex-wrap items-baseline gap-x-3">
            {crumbs && (
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                {crumbs.map((c, i) => (
                  <li key={c.href} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <span className="text-faint" aria-hidden="true">
                        /
                      </span>
                    )}
                    {/* A full-size tap target around a small line of text. */}
                    <Link href={c.href} className="relative hover:text-ink after:absolute after:-inset-x-1 after:-inset-y-3">
                      {c.label}
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
            )}
            {reference && <span className="ref text-xs text-faint">{reference}</span>}
            </div>
          )}
          <h1 className="text-2xl leading-tight tracking-[-0.025em] sm:text-[30px]">{title}</h1>
          {description && <p className="max-w-[68ch] text-sm text-muted">{description}</p>}
          {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-sm text-muted">{meta}</div>}
        </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className={sheet ? "-mx-5 border-t border-line px-5 sm:-mx-7 sm:px-7" : ""}>{children}</div>}
    </header>
  );
}

/** One fact in the header meta row: a quiet label and its value. */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-faint">{label}</span>
      <span className="num font-medium text-ink">{children}</span>
    </span>
  );
}
