"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { linkButton } from "./ui";

/** The tender's activity log button, marked as the current page while you are on it. */
export function ActivityLink({ href }: { href: string }) {
  const here = usePathname() === href;
  return (
    <Link href={href} aria-current={here ? "page" : undefined} className={`${linkButton.secondary} ${here ? "border-dye bg-dye-soft text-dye" : ""}`}>
      Activity log
    </Link>
  );
}
