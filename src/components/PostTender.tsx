"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { publishTenderAction } from "@/app/actions";
import { DESTINATIONS, money } from "@/lib/format";
import { notifyError, notifySuccess } from "./ActionButton";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { Button, Panel, Pill } from "./ui";

type Phase = "write" | "drafting" | "review";

const EXAMPLE =
  "I need 300 handmade batik napkins for our four hotels in Germany. Budget is around 3,000 euros before VAT, and we need them within 4 weeks. Real handmade, not printed.";

// The criteria the buyer publishes. Sellers see them before they bid.
const CRITERIA = [
  { name: "Delivered cost", weightPct: 40, rubric: "Lowest delivered cost inside budget scores highest." },
  { name: "Handmade proof", weightPct: 25, rubric: "Stated technique, confirmed in clarification." },
  { name: "Lead time", weightPct: 20, rubric: "Inside the delivery window, earlier scores higher." },
  { name: "Completeness", weightPct: 15, rubric: "All fields filled and customs code confirmed." },
];

type Draft = { title: string; item: string; quantity: number; budget: number; deliveryDays: number; destination: "DE" | "US" };

/** "3,000", "3.000", "3k", "2.5k" become 3000 or 2500. */
function amount(raw: string, suffix?: string) {
  const n = Number(raw.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."));
  return /k/i.test(suffix ?? "") ? n * 1000 : n;
}

/** Scripted stand-in for the AI drafting role: a first guess at quantity, item, budget and
 * weeks from plain words. The buyer checks and edits every field before publishing. */
function draftFrom(need: string): Draft {
  const qty = need.match(/\b(\d{1,6})\s+(?!euros?\b|eur\b|weeks?\b|days?\b)([a-z][a-z\s-]{2,60}?)(?=\s+for\b|\s+to\b|[.,]|$)/i);
  const quantity = Number(qty?.[1] ?? 1);
  const item = (qty?.[2] ?? "items").trim();
  // A budget is a number next to "budget", a currency sign, or a currency word.
  const b =
    need.match(/budget[^\d€$]{0,25}[€$]?\s?(\d[\d.,]*)\s*(k)?/i) ??
    need.match(/[€$]\s?(\d[\d.,]*)\s*(k)?/) ??
    need.match(/(\d[\d.,]*)\s*(k)?\s*(?:euros?|eur|dollars?|usd)\b/i);
  const usd = /\$|\busd\b|dollars?/i.test(need);
  const budget = b ? amount(b[1], b[2]) : 1000;
  const weeks = Number(need.match(/(\d+)\s*weeks?/i)?.[1] ?? 4);
  return {
    title: `${quantity} ${item}`,
    item: item.charAt(0).toUpperCase() + item.slice(1),
    quantity,
    budget: Math.round(budget),
    // Dollars or a US city in the request point to a US delivery; otherwise Germany.
    destination: usd || /\b(new york|usa|united states|us)\b/i.test(need) ? "US" : "DE",
    // A PayPal hold lasts 29 days, so the window is capped at 28.
    deliveryDays: Math.min(28, weeks * 7),
  };
}

/** What is wrong with the draft, in the buyer's words, or null. */
function problem(d: Draft): string | null {
  if (!d.title.trim()) return "Give the tender a title.";
  if (!Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > 100_000) return "Quantity must be between 1 and 100,000.";
  if (!Number.isFinite(d.budget) || d.budget < 50 || d.budget > 1_000_000) return "Budget must be between 50 and 1,000,000.";
  if (!Number.isInteger(d.deliveryDays) || d.deliveryDays < 1 || d.deliveryDays > 28) return "Delivery must be 1 to 28 days, inside the 29-day PayPal hold.";
  return null;
}

export function PostTender() {
  const router = useRouter();
  const [need, setNeed] = useState(EXAMPLE);
  const [photos, setPhotos] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("write");
  const [weights, setWeights] = useState(CRITERIA.map((c) => c.weightPct));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const total = weights.reduce((a, b) => a + b, 0);
  const tooShort = need.trim().length < 20;
  const [d, setD] = useState<Draft>(() => draftFrom(EXAMPLE));
  const issue = problem(d);
  const dest = DESTINATIONS.find((x) => x.country === d.destination) ?? DESTINATIONS[0];
  const edit = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));

  const balance = () => {
    const scaled = weights.map((w) => Math.round(((w / (total || 1)) * 100) / 5) * 5);
    const diff = 100 - scaled.reduce((a, b) => a + b, 0);
    const biggest = scaled.indexOf(Math.max(...scaled));
    setWeights(scaled.map((w, i) => (i === biggest ? w + diff : w)));
  };

  const publish = () =>
    start(async () => {
      setError(null);
      const r = await publishTenderAction({
        title: d.title.trim(),
        needText: need,
        item: d.item,
        quantity: d.quantity,
        budgetCents: Math.round(d.budget * 100),
        destination: d.destination,
        deliveryDays: d.deliveryDays,
        closesInDays: 7,
        criteria: CRITERIA.map((c, i) => ({ ...c, weightPct: weights[i] })),
        photos,
      });
      if (!r.ok) {
        setError(r.error);
        return notifyError(r.error);
      }
      notifySuccess(["Tender published", "Sellers can see it now. Bids stay sealed until it closes."]);
      router.push(`/tender/${r.tenderId}`);
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="notice grid content-start gap-4 self-start rounded-xl p-5 sm:p-6">
        <label htmlFor="need" className="text-sm font-medium">
          What do you need?
        </label>
        <textarea
          id="need"
          value={need}
          onChange={(e) => setNeed(e.target.value)}
          rows={7}
          aria-describedby="need-hint"
          className="w-full resize-y rounded-lg border border-line-strong bg-surface p-3.5 leading-relaxed outline-none placeholder:text-faint focus:border-dye focus:ring-2 focus:ring-dye/15"
        />
        <p id="need-hint" className={`-mt-2 text-xs ${tooShort && need.length > 0 ? "text-flag" : "text-muted"}`}>
          {tooShort ? "Write at least a sentence: what, how many, by when and roughly what budget." : "Plain words are fine. The AI turns them into specs and criteria."}
        </p>
        <PhotoPicker photos={photos} onChange={setPhotos} label="Reference photos (optional)" hint="A photo of the style, colour or size you want helps sellers price the right thing." />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={phase === "review" ? "secondary" : "primary"}
            onClick={() => {
              setPhase("drafting");
              setD(draftFrom(need));
              setTimeout(() => setPhase("review"), 900);
            }}
            loading={phase === "drafting"}
            disabled={tooShort}
          >
            {phase === "drafting" ? "Drafting…" : phase === "review" ? "Draft again" : "Draft the tender"}
          </Button>
          <span className="text-sm text-muted">Nothing goes out until you publish.</span>
        </div>
      </div>

      <Panel className={`grid content-start gap-5 ${phase === "write" ? "border-dashed !border-line-strong !bg-transparent" : ""}`}>
        {phase === "write" && (
          <div className="grid justify-items-center gap-1 px-6 py-14 text-center">
            <p className="text-sm font-medium">No draft yet</p>
            <p className="max-w-[40ch] text-sm text-muted">Describe your need and select Draft the tender. Specs, scoring, budget and deadline appear here.</p>
          </div>
        )}
        {phase === "drafting" && (
          <div className="grid gap-3 py-6" aria-live="polite">
            <p className="text-sm text-muted">Reading your request…</p>
            {[80, 64, 72, 50].map((w, i) => (
              <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {phase === "review" && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <p className="text-sm text-muted">Check the draft and fix anything the AI read wrong.</p>
                <p className="text-xs text-faint">Delivered at place. Import duty and any import VAT are paid by you. Bids close in 7 days.</p>
              </div>
              <Pill>Draft</Pill>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DraftField label="Deliver to" hint={`PayPal holds the money in ${dest.currency}`} className="sm:col-span-2">
                <select value={d.destination} onChange={(e) => edit({ destination: e.target.value as Draft["destination"] })} className={input}>
                  {DESTINATIONS.map((x) => (
                    <option key={x.country} value={x.country}>
                      {x.label} ({x.currency})
                    </option>
                  ))}
                </select>
              </DraftField>
              <DraftField label="Title" className="sm:col-span-2">
                <input value={d.title} onChange={(e) => edit({ title: e.target.value })} className={input} />
              </DraftField>
              <DraftField label="Quantity">
                <input type="number" min={1} step={1} inputMode="numeric" value={d.quantity} onChange={(e) => edit({ quantity: Math.round(Number(e.target.value)) })} className={`num ${input}`} />
              </DraftField>
              <DraftField label="Item">
                <input value={d.item} onChange={(e) => edit({ item: e.target.value })} className={input} />
              </DraftField>
              <DraftField label={dest.country === "DE" ? `Budget, excl. VAT (${dest.currency})` : `Budget (${dest.currency})`} hint={Number.isFinite(d.budget) ? money(d.budget * 100, dest.currency) : ""}>
                <input type="number" min={50} step={50} inputMode="numeric" value={d.budget} onChange={(e) => edit({ budget: Number(e.target.value) })} className={`num ${input}`} />
              </DraftField>
              <DraftField label="Delivery window (days)" hint="28 at most: a PayPal hold lasts 29 days">
                <input type="number" min={1} max={28} step={1} inputMode="numeric" value={d.deliveryDays} onChange={(e) => edit({ deliveryDays: Math.round(Number(e.target.value)) })} className={`num ${input}`} />
              </DraftField>
            </div>
            {issue && (
              <p role="alert" className="-mt-2 text-sm text-flag">
                {issue}
              </p>
            )}

            {photos.length > 0 && (
              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">Reference photos sellers will see</h3>
                <PhotoStrip photos={photos} label="Reference photos" size="sm" />
              </div>
            )}

            <div className="grid gap-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">How bids are scored</h3>
                <span className="flex items-center gap-2" aria-live="polite">
                  <span className={`text-xs ${total === 100 ? "text-muted" : "font-medium text-flag"}`}>
                    {total === 100 ? "Weights add up to 100%" : `${total}% in total, ${Math.abs(total - 100)}% ${total > 100 ? "over" : "short"}`}
                  </span>
                  {total !== 100 && (
                    <button type="button" onClick={balance} className="min-h-8 rounded-md border border-line-strong px-2 text-xs font-medium text-dye hover:bg-dye-soft">
                      Balance to 100%
                    </button>
                  )}
                </span>
              </div>
              {CRITERIA.map((c, i) => (
                <div key={c.name} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
                  <label htmlFor={`w-${i}`} className="text-sm">
                    {c.name} <span className="text-muted">({c.rubric.toLowerCase()})</span>
                  </label>
                  <span className="num w-10 text-right text-sm font-semibold">{weights[i]}%</span>
                  <input
                    id={`w-${i}`}
                    type="range"
                    min={0}
                    max={80}
                    step={5}
                    value={weights[i]}
                    onChange={(e) => setWeights(weights.map((w, j) => (j === i ? Number(e.target.value) : w)))}
                    className="col-span-2 accent-[var(--dye)]"
                  />
                </div>
              ))}
              <p className="text-xs text-muted">Sellers see these weights. Who replies first never counts.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button disabled={total !== 100 || !!issue} loading={pending} onClick={publish}>
                Publish tender
              </Button>
              <Button variant="secondary" onClick={() => setPhase("write")}>
                Edit my request
              </Button>
              {error && (
                <p role="alert" className="text-sm text-flag">
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

const input =
  "min-h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-dye focus:ring-2 focus:ring-dye/15";

function DraftField({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`grid gap-1 text-sm ${className}`}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </label>
  );
}
