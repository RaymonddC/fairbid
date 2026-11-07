import { LoginForm } from "@/components/LoginForm";
import { LogoMark } from "@/components/Logo";
import { Pill } from "@/components/ui";
import { DEMO_EMAILS, DEMO_PASSWORD } from "@/lib/accounts";
import { DEMO_USERS } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";
import { signInAction } from "./actions";

export const metadata = { title: "Sign in · FairBid" };

const tries: Record<string, string> = {
  "buyer-anna": "Compare sealed bids at delivered cost, award, and pay step by step through a PayPal hold.",
  "seller-sari": "Bid on open tenders from the quest board, answer questions, and see what you are paid.",
};

const flow = ["Sealed bids", "Questions", "Delivered cost", "PayPal hold and pay"];

// Two ways in: an email and password, or one click on a demo account (lib/auth.ts).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <div className="mx-auto grid max-w-[960px] gap-10 py-4 sm:py-8">
      <div className="grid justify-items-start gap-3">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <Pill tone="ok" dot>
            PayPal sandbox, no real money
          </Pill>
        </div>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.03em] sm:text-[40px]">Sign in to FairBid</h1>
        <p className="max-w-[62ch] text-[15px] text-muted">
          Fair tenders across borders: every bid is compared at what it really costs delivered, and PayPal holds the money until the goods
          arrive.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="notice grid content-start gap-5 rounded-2xl p-6" aria-labelledby="signin-title">
          <h2 id="signin-title" className="text-lg">
            Sign in with email
          </h2>
          <LoginForm next={next} demoEmail={DEMO_EMAILS["buyer-anna"]} demoPassword={DEMO_PASSWORD} />
        </section>

        <section className="grid content-start gap-3" aria-labelledby="demo-title">
          <div className="grid gap-0.5">
            <h2 id="demo-title" className="text-lg">
              Or try a demo account
            </h2>
            <p className="text-sm text-muted">One click, no password. Sample people and illustrative numbers.</p>
          </div>
          <ul className="grid gap-3">
            {DEMO_USERS.map((u, i) => (
              <li key={u.id}>
                <form action={signInAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="next" value={next} />
                  <button
                    type="submit"
                    className={`notice group grid w-full gap-1 rounded-xl p-4 text-left transition-colors hover:border-dye ${i === 0 ? "accent-edge" : ""}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-3">
                        <span
                          className={`grid h-10 w-10 place-items-center rounded-full text-sm font-semibold ${i === 0 ? "bg-dye text-canvas" : "bg-dye-soft text-dye"}`}
                          aria-hidden="true"
                        >
                          {u.name[0]}
                        </span>
                        <span className="grid leading-tight">
                          <span className="font-medium">
                            Continue as {u.name}
                          </span>
                          <span className="text-xs capitalize text-muted">
                            {u.role}, {u.detail}
                          </span>
                        </span>
                      </span>
                      {i === 0 && <Pill tone="dye">Start here</Pill>}
                    </span>
                    <span className="pl-[52px] text-sm text-muted">{tries[u.id]}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      </div>

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
    </div>
  );
}
