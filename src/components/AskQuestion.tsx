"use client";

import { useState, useTransition } from "react";
import { askQuestionAction } from "@/app/actions";
import { notifyError, notifySuccess } from "./ActionButton";
import { Button } from "./ui";

/**
 * The buyer writes a question and picks which bids get it. Every chosen bid gets the same
 * words, so no seller hears something the others did not. Sellers answer from their tender page.
 */
export function AskQuestion({ tenderId, bids, scored = false }: { tenderId: string; bids: { id: string; letter: string }[]; scored?: boolean }) {
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const all = chosen.length === bids.length;
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const problem = text.trim().length < 10 ? "Write the question in a full sentence." : chosen.length === 0 ? "Choose at least one bid." : null;

  return (
    <form
      className="notice grid gap-3 rounded-xl p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) return;
        start(async () => {
          const r = await askQuestionAction(tenderId, text, chosen);
          if (!r.ok) return notifyError(r.error);
          const letters = bids.filter((b) => chosen.includes(b.id)).map((b) => b.letter);
          notifySuccess([`Question sent to bid${letters.length > 1 ? "s" : ""} ${letters.join(", ")}`, "Each seller sees it on their tender page. Their price stays locked."]);
          setText("");
          setChosen([]);
        });
      }}
    >
      <div className="grid gap-0.5">
        <h3 className="text-sm">Ask sellers a question</h3>
        <p className="text-xs text-muted">
          The same words go to every bid you choose. An answer can never change a price.
          {scored ? " The bids are already scored: the answer is kept with the bid, the scores stay as they are." : ""}
        </p>
      </div>
      <label htmlFor="ask-text" className="sr-only">
        Your question
      </label>
      <textarea
        id="ask-text"
        rows={3}
        value={text}
        maxLength={600}
        onChange={(e) => setText(e.target.value)}
        placeholder="Can you confirm the napkins are 100% cotton and send a photo of the label?"
        className="rounded-lg border border-line-strong bg-surface p-2.5 text-sm outline-none placeholder:text-faint focus:border-dye focus:ring-2 focus:ring-dye/15"
      />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-medium text-muted">Send to</legend>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setChosen(all ? [] : bids.map((b) => b.id))}
            aria-pressed={all}
            className={`min-h-9 rounded-full px-3 text-sm transition-colors ${all ? "bg-dye text-canvas" : "bg-canvas text-muted ring-1 ring-inset ring-line hover:text-ink"}`}
          >
            All bids
          </button>
          {bids.map((b) => {
            const on = chosen.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggle(b.id)}
                aria-pressed={on}
                className={`min-h-9 min-w-11 rounded-full px-3 text-sm font-medium transition-colors ${
                  on ? "bg-dye-soft text-dye ring-1 ring-inset ring-dye" : "bg-canvas text-muted ring-1 ring-inset ring-line hover:text-ink"
                }`}
              >
                Bid {b.letter}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted" aria-live="polite">
          {text.length > 0 || chosen.length > 0 ? (problem ?? `${text.trim().length}/600`) : ""}
        </span>
        <Button type="submit" variant="secondary" loading={pending} disabled={!!problem}>
          Send question
        </Button>
      </div>
    </form>
  );
}
