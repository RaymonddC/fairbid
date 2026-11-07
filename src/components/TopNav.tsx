"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signInAction, signOutAction } from "@/app/login/actions";
import { DEMO_USERS, type User } from "@/lib/auth";
import { Avatar } from "./Avatar";
import { LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

type Tab = { href: string; label: string; active: (path: string) => boolean };

/**
 * App navigation, one row on desktop: [logo] [page links] ... [sandbox] [theme] | [profile].
 * On phones the page links drop to a second row. Before login only the logo and theme show.
 */
export function TopNav({ user }: { user: User | null }) {
  const path = usePathname();
  const seller = user?.role === "seller";

  const tabs: Tab[] = !user
    ? []
    : seller
      ? [{ href: "/", label: "Open tenders", active: (p) => p === "/" || p.startsWith("/tender") }]
      : [
          { href: "/", label: "Tenders", active: (p) => p === "/" || p.startsWith("/tender") },
          { href: "/post", label: "Post a tender", active: (p) => p.startsWith("/post") },
        ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 px-4 sm:px-8 md:h-16 md:flex-nowrap">
        <Link href="/" className="order-1 flex h-14 items-center gap-2.5 md:h-auto" aria-label="FairBid home">
          <LogoMark size={32} />
          <span className="text-[15px] font-semibold tracking-tight text-ink">FairBid</span>
        </Link>

        {tabs.length > 0 && (
          <nav aria-label={seller ? "Seller" : "Buyer"} className="order-3 -mx-1 w-full self-stretch md:order-2 md:mx-0 md:w-auto">
            <ul className="flex h-11 gap-1 overflow-x-auto [scrollbar-width:none] md:h-full">
              {tabs.map((tab) => {
                const on = tab.active(path);
                return (
                  <li key={tab.href} className="flex">
                    <Link
                      href={tab.href}
                      aria-current={on ? "page" : undefined}
                      className={`relative flex items-center gap-2 whitespace-nowrap px-3 text-sm transition-colors after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full ${
                        on ? "font-medium text-ink after:bg-ink" : "text-muted after:bg-transparent hover:text-ink"
                      }`}
                    >
                      {tab.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div className="order-2 ml-auto flex h-14 items-center gap-3 md:order-3 md:h-auto">
          <span className="hidden h-8 items-center gap-1.5 rounded-full px-3 text-xs text-muted ring-1 ring-inset ring-line lg:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
            PayPal sandbox
          </span>
          <div className={user ? "hidden sm:block" : ""}>
            <ThemeToggle compact />
          </div>
          {user && (
            <>
              <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
              <AccountMenu user={user} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Profile menu: switch between the demo buyer and seller, or sign out. Escape closes it. */
function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const path = usePathname();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("[data-menu] button")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account: ${user.name}, ${user.role}`}
        className="flex h-10 items-center gap-2.5 rounded-full pl-1 pr-2 text-sm transition-colors hover:bg-surface"
      >
        <Avatar id={user.id} size={32} />
        <span className="hidden text-left leading-tight sm:grid">
          <span className="font-medium text-ink">{user.name}</span>
          <span className="text-[11px] capitalize text-faint">{user.role}</span>
        </span>
        <Chevron />
      </button>

      {open && (
        <div id={menuId} data-menu className="notice fade-in absolute right-0 top-full z-50 mt-2 grid w-72 gap-1 rounded-xl p-1.5 shadow-xl">
          <p className="px-2.5 pb-0.5 pt-1.5 text-xs text-faint">Viewing as</p>
          {DEMO_USERS.map((p) => {
            const on = p.id === user.id;
            return (
              <form key={p.id} action={signInAction}>
                <input type="hidden" name="userId" value={p.id} />
                <input type="hidden" name="next" value="/" />
                <button
                  type="submit"
                  disabled={on}
                  aria-current={on ? "true" : undefined}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left ${on ? "bg-canvas" : "hover:bg-canvas"}`}
                >
                  <Avatar id={p.id} size={32} ring={on} />
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                    <span className="truncate text-xs text-faint">
                      <span className="capitalize">{p.role}</span>, {p.detail}
                    </span>
                  </span>
                  {on && <Tick />}
                </button>
              </form>
            );
          })}
          <form action={signOutAction}>
            <button type="submit" className="flex min-h-10 w-full items-center rounded-lg px-2.5 text-sm text-muted hover:bg-canvas hover:text-ink">
              Sign out
            </button>
          </form>
          <div className="mt-1 grid gap-2 border-t border-line px-2.5 pb-1.5 pt-2.5 sm:hidden">
            <span className="text-xs text-faint">Theme</span>
            <ThemeToggle />
          </div>
          <p className="border-t border-line px-2.5 pb-1.5 pt-2.5 text-xs leading-relaxed text-muted">
            Money is held by PayPal until each step is confirmed. FairBid never holds funds.
          </p>
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-faint" aria-hidden="true">
      <path d="M5 6.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-dye" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
