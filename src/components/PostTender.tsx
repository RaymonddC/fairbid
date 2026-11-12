"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { draftTenderAction, publishTenderAction } from "@/app/actions";
import { draftFrom, type Draft } from "@/lib/draft";
import { DESTINATIONS, money } from "@/lib/format";
import { notifyError, notifySuccess } from "./ActionButton";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { Button, Panel } from "./ui";
import { MAX_DELIVERY_DAYS, phaseCount, planMilestones } from "@/lib/phases";

type Phase = "write" | "drafting" | "review";

const EXAMPLE =
  "I need 300 handmade batik napkins for our four hotels in Germany. Budget is around 3,000 euros before VAT, and we need them within 4 weeks. Real handmade, not printed.";

// The criteria the tender owner publishes. Bidders see them before they bid.
const CRITERIA = [
  { name: "Delivered cost", weightPct: 40, rubric: "Lowest delivered cost inside budget scores highest." },
  { name: "Handmade proof", weightPct: 25, rubric: "Stated technique, confirmed in clarification." },
  { name: "Lead time", weightPct: 20, rubric: "Inside the delivery window, earlier scores higher." },
  { name: "Completeness", weightPct: 15, rubric: "All fields filled and customs code confirmed." },
];

/** How the money will be held for this window: one hold, or one per phase. */
function holdsHint(days: number): string {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DELIVERY_DAYS) return `1 to ${MAX_DELIVERY_DAYS} days`;
  const phases = phaseCount(planMilestones(days));
  return phases === 1 ? "One PayPal hold covers it" : `Over 28 days: paid in ${phases} PayPal holds, one per phase`;
}

/** What is wrong with the draft, in the owner's words, or null. */
function problem(d: Draft): string | null {
  if (!d.title.trim()) return "Give the tender a title.";
  if (!Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > 100_000) return "Quantity must be between 1 and 100,000.";
  if (!Number.isFinite(d.budget) || d.budget < 50 || d.budget > 1_000_000) return "Budget must be between 50 and 1,000,000.";
  if (!Number.isInteger(d.deliveryDays) || d.deliveryDays < 1 || d.deliveryDays > MAX_DELIVERY_DAYS) return `Delivery must be 1 to ${MAX_DELIVERY_DAYS} days.`;
  return null;
}

/**
 * Posting a tender with an AI that does the writing: say it in plain words, the AI drafts the
 * tender and asks what the request leaves open, the answers go back in and it drafts again,
 * and the owner checks the result and publishes. Nothing goes out before Publish.
 */
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
  const [draftNote, setDraftNote] = useState<string | null>(null);
  // The AI's questions about what the request leaves open, and the owner's answers.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const issue = problem(d);
  const dest = DESTINATIONS.find((x) => x.country === d.destination) ?? DESTINATIONS[0];
  const edit = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const answered = d.questions.filter((q) => answers[q]?.trim());

  const balance = () => {
    const scaled = weights.map((w) => Math.round(((w / (total || 1)) * 100) / 5) * 5);
    const diff = 100 - scaled.reduce((a, b) => a + b, 0);
    const biggest = scaled.indexOf(Math.max(...scaled));
    setWeights(scaled.map((w, i) => (i === biggest ? w + diff : w)));
  };

  /** The tender writer (Gemini, or its scripted guess without the AI). A failed call still leaves a draft to edit. */
  const draft = async (text: string) => {
    setPhase("drafting");
    setDraftNote(null);
    const r = await draftTenderAction(text);
    if (r.ok) {
      setD(r.draft);
      setDraftNote(r.source === "model" ? null : "Drafted by the scripted guess, not the AI. Check every field.");
    } else {
      setD(draftFrom(text));
      notifyError(r.error);
    }
    setAnswers({});
    setPhase("review");
  };

  // The owner's answers join the request in their own words, and the AI drafts again from all of it.
  const refine = () => {
    const more = answered.map((q) => `${q} ${answers[q].trim()}`).join("\n");
    const next = `${need.trim()}\n${more}`;
    setNeed(next);
    void draft(next);
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
      notifySuccess(["Tender published", "Bidders can see it now. Bids stay sealed until it closes."]);
      router.push(`/tender/${r.tenderId}`);
    });

  return (
    <div className="grid max-w-[760px] gap-6">
      {/* Step 1: say it in plain words. One action. */}
      {phase === "write" && (
        <Panel className="grid content-start gap-4">
          <label htmlFor="need" className="font-medium">
            What do you need?
          </label>
          <textarea
            id="need"
            value={need}
            onChange={(e) => setNeed(e.target.value)}
            rows={5}
            aria-describedby="need-hint"
            className="w-full resize-y rounded-lg border border-line-strong bg-surface p-3.5 leading-relaxed outline-none placeholder:text-faint focus:border-dye focus:ring-2 focus:ring-dye/15"
          />
          <p id="need-hint" className={`-mt-2 text-xs ${tooShort && need.length > 0 ? "text-flag" : "text-muted"}`}>
            {tooShort
              ? "Write at least a sentence: what, how many, by when and roughly what budget."
              : "What, how many, where, by when and roughly what budget. Plain words are fine."}
          </p>
          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-medium text-dye underline-offset-4 hover:underline">
              {photos.length ? `Reference photos (${photos.length})` : "Add a reference photo (optional)"}
            </summary>
            <div className="pt-3">
              <PhotoPicker photos={photos} onChange={setPhotos} label="Reference photos" hint="The style, colour or size you want. Bidders see it." />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button onClick={() => draft(need)} disabled={tooShort}>
              Draft it with AI
            </Button>
            <span className="text-sm text-muted">Nothing goes out until you publish.</span>
          </div>
        </Panel>
      )}

      {phase === "drafting" && (
        <Panel className="grid gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            Your AI is reading your request and drafting the tender…
          </p>
          {[80, 64, 72, 50].map((w, i) => (
            <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
          ))}
        </Panel>
      )}

      {phase === "review" && (
        <>
          {/* Step 2: the AI says what it read, and asks what the request leaves open. */}
          <Panel className="grid gap-3">
            <p className="text-xs font-medium text-muted">Your AI</p>
            <p>
              I drafted this from your words: {d.quantity.toLocaleString("en")} × {d.item.toLowerCase()} to {dest.label}, a budget of{" "}
              {Number.isFinite(d.budget) ? money(d.budget * 100, dest.currency) : "?"}
              {dest.country === "DE" ? " before VAT" : ""}, delivered within {d.deliveryDays} days. Fix anything I read wrong below.
            </p>
            {draftNote && <p className="text-xs text-warn">{draftNote}</p>}
            {d.questions.length > 0 && (
              <div className="grid gap-3 border-t border-line pt-3">
                <p className="text-sm">Bidders will price this better if you tell me:</p>
                {d.questions.map((q) => (
                  <label key={q} className="grid gap-1 text-sm">
                    <span className="text-muted">{q}</span>
                    <input
                      value={answers[q] ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                      placeholder="Your answer, or leave it"
                      className={input}
                    />
                  </label>
                ))}
                <div>
                  <Button variant="secondary" onClick={refine} disabled={answered.length === 0}>
                    Update the draft
                  </Button>
                </div>
              </div>
            )}
          </Panel>

          {/* Step 3: the tender as bidders will read it, editable in place. */}
          <Panel className="grid gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg">The tender</h2>
              <span className="text-xs text-faint">Delivered at place. You pay import duty and VAT. Bids close in 7 days.</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DraftField label="Title" className="sm:col-span-2">
                <input value={d.title} onChange={(e) => edit({ title: e.target.value })} className={input} />
              </DraftField>
              <DraftField label="Item">
                <input value={d.item} onChange={(e) => edit({ item: e.target.value })} className={input} />
              </DraftField>
              <DraftField label="Quantity">
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={d.quantity}
                  onChange={(e) => edit({ quantity: Math.round(Number(e.target.value)) })}
                  className={`num ${input}`}
                />
              </DraftField>
              <DraftField label={dest.country === "DE" ? `Budget, excl. VAT (${dest.currency})` : `Budget (${dest.currency})`}>
                <input
                  type="number"
                  min={50}
                  step={50}
                  inputMode="numeric"
                  value={d.budget}
                  onChange={(e) => edit({ budget: Number(e.target.value) })}
                  className={`num ${input}`}
                />
              </DraftField>
              <DraftField label="Delivery window (days)" hint={holdsHint(d.deliveryDays)}>
                <input
                  type="number"
                  min={1}
                  max={MAX_DELIVERY_DAYS}
                  step={1}
                  inputMode="numeric"
                  value={d.deliveryDays}
                  onChange={(e) => edit({ deliveryDays: Math.round(Number(e.target.value)) })}
                  className={`num ${input}`}
                />
              </DraftField>
              <DraftField label="Deliver to" hint={`PayPal holds the money in ${dest.currency}`} className="sm:col-span-2">
                <select value={d.destination} onChange={(e) => edit({ destination: e.target.value as Draft["destination"] })} className={input}>
                  {DESTINATIONS.map((x) => (
                    <option key={x.country} value={x.country}>
                      {x.label} ({x.currency})
                    </option>
                  ))}
                </select>
              </DraftField>
            </div>
            {issue && (
              <p role="alert" className="-mt-2 text-sm text-flag">
                {issue}
              </p>
            )}
            {photos.length > 0 && <PhotoStrip photos={photos} label="Reference photos" size="sm" />}

            {/* The scoring starts sensible; it opens only for someone who wants to change it. */}
            <details className="group border-t border-line pt-3" open={total !== 100}>
              <summary className="cursor-pointer list-none text-sm">
                <span className="font-medium">How bids are scored:</span>{" "}
                <span className="text-muted">{CRITERIA.map((c, i) => `${c.name.toLowerCase()} ${weights[i]}%`).join(", ")}</span>{" "}
                <span className="text-dye underline-offset-4 hover:underline group-open:hidden">Change</span>
              </summary>
              <div className="grid gap-3 pt-3">
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
                <span className="flex items-center gap-2 text-xs" aria-live="polite">
                  <span className={total === 100 ? "text-muted" : "font-medium text-flag"}>
                    {total === 100
                      ? "Adds up to 100%. Bidders see these weights; who replies first never counts."
                      : `${total}% in total, ${Math.abs(total - 100)}% ${total > 100 ? "over" : "short"}`}
                  </span>
                  {total !== 100 && (
                    <button type="button" onClick={balance} className="min-h-8 rounded-md border border-line-strong px-2 font-medium text-dye hover:bg-dye-soft">
                      Balance to 100%
                    </button>
                  )}
                </span>
              </div>
            </details>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button disabled={total !== 100 || !!issue} loading={pending} onClick={publish}>
                Publish tender
              </Button>
              <button type="button" onClick={() => setPhase("write")} className="min-h-11 text-sm text-muted underline underline-offset-4 hover:text-ink">
                Change my request
              </button>
              {error && (
                <p role="alert" className="text-sm text-flag">
                  {error}
                </p>
              )}
            </div>
          </Panel>
        </>
      )}
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
