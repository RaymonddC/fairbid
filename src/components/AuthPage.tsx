import { DEMO_EMAILS, DEMO_PASSWORD } from "@/lib/accounts";
import { DEMO_USERS } from "@/lib/auth";
import { AuthPanel } from "./AuthPanel";
import { LogoMark } from "./Logo";
import { Pill } from "./ui";

const points = [
  { title: "Sealed bids", body: "Prices stay hidden until bidding closes, so a fast reply never beats a good one." },
  { title: "Delivered cost", body: "Every bid is compared with shipping, import duty and fees included." },
  { title: "Paid on delivery", body: "PayPal holds the money and pays the seller step by step. FairBid never holds funds." },
];

/** Shared by /login and /register: the brand side, and one card that slides between the two forms. */
export function AuthPage({ initial, next }: { initial: "login" | "register"; next: string }) {
  return (
    <div className="mx-auto grid max-w-[1040px] items-start gap-10 py-2 sm:py-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16">
      <div className="grid content-start gap-8 lg:pt-6">
        <div className="grid justify-items-start gap-4">
          <div className="flex items-center gap-3">
            <LogoMark size={40} />
            <Pill tone="ok" dot>
              PayPal sandbox, no real money
            </Pill>
          </div>
          <h1 className="max-w-[16ch] text-[34px] leading-[1.08] tracking-[-0.03em] sm:text-[44px]">Fair tenders across borders</h1>
          <p className="max-w-[46ch] text-[15px] text-muted">
            Small buyers get sealed bids from makers abroad, compared at what they really cost to deliver, and pay only as the order moves.
          </p>
        </div>
        <ul className="grid gap-4">
          {points.map((p) => (
            <li key={p.title} className="grid grid-cols-[28px_1fr] gap-3">
              <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-lg bg-dye-soft text-dye" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{p.title}</span>
                <span className="text-sm text-muted">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <AuthPanel
        initial={initial}
        next={next}
        demoEmail={DEMO_EMAILS["buyer-anna"]}
        demoPassword={DEMO_PASSWORD}
        demoAccounts={DEMO_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, detail: u.detail }))}
      />
    </div>
  );
}
