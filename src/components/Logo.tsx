/** FairBid mark: an F on the brand indigo, its middle bar ending in a gold dot, the winning bid.
 * Fixed colours, so it reads the same in light and dark mode. */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2e3fa3" />
      <path d="M10 8h12M10 8v16M10 15.5h7" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="22" cy="15.5" r="2.6" fill="#e3a72f" />
    </svg>
  );
}
