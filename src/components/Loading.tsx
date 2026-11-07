// Loading states for when the screens fetch from the FairBid API.
// Next.js shows `loading.tsx` automatically while a route's server components await data;
// use <LoadingCard> or <Button loading> for client-side requests (for example a PayPal capture).

/** A small ring spinner in the current text colour. */
export function Spinner({ size = 20, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 3a9 9 0 019 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Full page: header placeholders, then content blocks. Used by app/loading.tsx. */
export function PageLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid gap-6" aria-busy="true" aria-live="polite">
      <div className="grid gap-2.5">
        <div className="skeleton h-3.5 w-28" />
        <div className="skeleton h-7 w-full max-w-sm" />
        <div className="skeleton h-3.5 w-full max-w-lg" />
      </div>
      <SectionLoading label={label} />
    </div>
  );
}

/** Content only, for routes whose header and step tabs are already on screen. */
export function SectionLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid gap-4" aria-busy="true" aria-live="polite">
      <BlockSkeleton tall />
      <div className="grid gap-4 sm:grid-cols-2">
        <BlockSkeleton />
        <BlockSkeleton />
      </div>
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner size={15} label={label} />
        {label}
      </p>
    </div>
  );
}

/** A block that is waiting for data, with a spinner and a plain message. */
export function LoadingCard({ label }: { label: string }) {
  return (
    <div className="notice flex items-center gap-3 rounded-xl p-5 text-sm text-muted" aria-busy="true" aria-live="polite">
      <Spinner size={16} label={label} />
      {label}
    </div>
  );
}

function BlockSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="notice grid gap-3 rounded-xl p-5">
      <div className="skeleton h-3 w-24" />
      <div className={`skeleton w-2/3 ${tall ? "h-6" : "h-5"}`} />
      <div className="skeleton h-3 w-full" />
      {tall && <div className="skeleton h-3 w-5/6" />}
    </div>
  );
}
