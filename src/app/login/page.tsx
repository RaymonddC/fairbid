import { DEMO_USERS } from "@/lib/auth";
import { Pill } from "@/components/ui";
import { signInAction } from "./actions";

export const metadata = { title: "Choose a demo account · FairBid" };

const extra: Record<string, { tries: string[]; cta: string; primary: boolean }> = {
  "buyer-anna": {
    tries: [
      "Open the sealed bids and read the AI's questions to sellers",
      "Compare every bid at its delivered cost in Berlin",
      "Award the winner and pay step by step through a PayPal hold",
    ],
    cta: "Continue as Anna",
    primary: true,
  },
  "seller-sari": {
    tries: [
      "Confirm the suggested customs code for the napkins",
      "See the delivered price the buyer will compare before you bid",
      "Answer the buyer's question; your price stays locked",
    ],
    cta: "Continue as Sari",
    primary: false,
  },
};

const flow = ["Sealed bids", "AI questions", "Delivered cost", "PayPal hold and pay"];

// Entry point for judges: pick the buyer or the seller, no password (lib/auth.ts).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto grid max-w-[880px] gap-10 py-4 sm:py-10">
      <div className="grid justify-items-start gap-3">
        <Pill tone="ok" dot>
          Demo in the PayPal sandbox, no real money
        </Pill>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.03em] sm:text-[40px]">Choose who you are for this demo</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          FairBid runs a fair tender across borders: every bid is compared at what it really costs delivered, and PayPal holds the money
          until the goods arrive. Try it as the hotel buying, or as the workshop selling.
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {DEMO_USERS.map((u) => {
          const e = extra[u.id] ?? { tries: [], cta: `Continue as ${u.name}`, primary: false };
          return (
            <li key={u.id}>
              <article className={`notice grid h-full content-between gap-6 rounded-2xl p-6 ${e.primary ? "accent-edge" : ""}`}>
                <div className="grid gap-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`grid h-11 w-11 place-items-center rounded-full text-sm font-semibold ${
                          e.primary ? "bg-dye text-canvas" : "bg-dye-soft text-dye"
                        }`}
                        aria-hidden="true"
                      >
                        {u.name[0]}
                      </span>
                      <div className="grid leading-tight">
                        <h2 className="text-lg">{u.name}</h2>
                        <span className="text-sm capitalize text-muted">{u.role}</span>
                      </div>
                    </div>
                    {e.primary && <Pill tone="dye">Start here</Pill>}
                  </div>
                  <p className="text-sm text-muted">{u.detail}.</p>
                  <div className="grid gap-2">
                    <h3 className="text-xs font-medium text-faint">What you can try</h3>
                    <ul className="grid gap-2 text-sm">
                      {e.tries.map((t) => (
                        <li key={t} className="flex gap-2.5">
                          <Check />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <form action={signInAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="next" value={next ?? "/"} />
                  <button
                    type="submit"
                    className={`inline-flex min-h-10 w-full items-center justify-center rounded-lg px-3.5 text-sm font-medium transition-colors ${
                      e.primary ? "bg-dye text-canvas hover:bg-dye-hover" : "border border-line-strong bg-surface text-ink hover:bg-canvas"
                    }`}
                  >
                    {e.cta}
                  </button>
                </form>
              </article>
            </li>
          );
        })}
      </ul>

      <section className="grid gap-4" aria-labelledby="flow-title">
        <h2 id="flow-title" className="text-sm text-muted">
          The tender, start to finish
        </h2>
        <ol className="grid gap-3 sm:grid-cols-4">
          {flow.map((f, i) => (
            <li key={f} className="flex items-center gap-2.5 text-sm sm:grid sm:gap-2">
              <span className="flex items-center gap-2">
                <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold text-ink ring-1 ring-line-strong">
                  {i + 1}
                </span>
                {i < flow.length - 1 && <span className="hidden h-px flex-1 bg-line-strong sm:block" aria-hidden="true" />}
              </span>
              <span className="text-ink">{f}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="border-t border-line pt-5 text-sm text-muted">
        Sample people and illustrative numbers. The buyer approves the hold with a PayPal sandbox personal account.
      </p>
    </div>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 shrink-0 text-ok" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
