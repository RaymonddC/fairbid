"use client";

import { useState, useTransition } from "react";
import { answerSellerQuestionAction, askBuyerAction } from "@/app/actions";
import { dayTime } from "@/lib/format";
import type { PublishedQuestion } from "@/lib/tender-questions";
import { notifyError, notifySuccess } from "./ActionButton";
import { Button, Panel, Pill } from "./ui";

// Mirrors QUESTION_MAX and ANSWER_MAX in src/lib/tender-questions.ts; the server checks again.
const QUESTION_MAX = 500;
const ANSWER_MAX = 1000;

const field =
  "rounded-lg border border-line-strong bg-surface p-2.5 text-sm outline-none placeholder:text-faint focus:border-dye focus:ring-2 focus:ring-dye/15";

function Answer({ q }: { q: PublishedQuestion }) {
  if (!q.answer) return <p className="text-sm font-medium text-warn">Waiting for the buyer</p>;
  return (
    <div className="grid gap-1 border-l-2 border-line-strong pl-3">
      <p className="whitespace-pre-line text-sm">{q.answer}</p>
      <p className="text-xs text-faint">
        {q.answeredBy === "buyer" ? "Answered by the buyer" : "Answered by the buyer's AI from the tender"}
        {q.answeredAt ? `, ${dayTime(q.answeredAt)}` : ""}
      </p>
    </div>
  );
}

/** The seller's side: ask the buyer before bidding, and read every published answer. */
export function SellerQA({ tenderId, questions, open }: { tenderId: string; questions: PublishedQuestion[]; open: boolean }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const trimmed = text.trim();
  const problem = trimmed.length < 10 ? "Write the question in a full sentence." : trimmed.length > QUESTION_MAX ? `Keep it under ${QUESTION_MAX} characters.` : null;
  if (!open && questions.length === 0) return null;

  return (
    <Panel className="grid gap-4">
      <div className="grid gap-0.5">
        <h2 className="text-base">Questions to the buyer</h2>
        <p className="text-xs text-muted">
          Every seller sees each answer, and nobody is told who asked. An answer never changes the tender.
        </p>
      </div>

      {questions.length > 0 ? (
        <ol className="grid divide-y divide-line border-y border-line">
          {questions.map((q) => (
            <li key={q.id} className="grid gap-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{q.question}</p>
                <span className="text-xs text-faint">{q.mine ? "You asked" : "A seller asked"}</span>
              </div>
              <Answer q={q} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">No questions yet.</p>
      )}

      {open && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return;
            start(async () => {
              const r = await askBuyerAction(tenderId, trimmed);
              if (!r.ok) return notifyError(r.error);
              setText("");
              notifySuccess(
                r.question.answer
                  ? ["Answered from the tender", "The buyer's AI answered. Every seller sees it."]
                  : ["Question sent to the buyer", "It waits for the buyer. The answer goes to every seller."],
              );
            });
          }}
        >
          <label htmlFor="ask-buyer" className="text-sm font-medium">
            Ask the buyer
          </label>
          <textarea
            id="ask-buyer"
            rows={2}
            value={text}
            maxLength={QUESTION_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder="For example: what finish or packing do you expect?"
            className={field}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted" aria-live="polite">
              {text.length > 0 ? (problem ?? `${trimmed.length}/${QUESTION_MAX}`) : "Your bid stays sealed. Up to 5 questions per tender."}
            </span>
            <Button type="submit" variant="secondary" loading={pending} disabled={!!problem}>
              Ask
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function AnswerBox({ q }: { q: PublishedQuestion }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const trimmed = text.trim();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length < 2) return;
        start(async () => {
          const r = await answerSellerQuestionAction(q.id, trimmed);
          if (!r.ok) return notifyError(r.error);
          setText("");
          notifySuccess(["Answer published", "Every seller sees it on the tender."]);
        });
      }}
    >
      <label htmlFor={`answer-${q.id}`} className="sr-only">
        Your answer to every seller
      </label>
      <textarea
        id={`answer-${q.id}`}
        rows={2}
        value={text}
        maxLength={ANSWER_MAX}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your answer, published to every seller"
        className={field}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">Answer from what the tender asks. It cannot change the terms.</span>
        <Button type="submit" variant="secondary" loading={pending} disabled={trimmed.length < 2}>
          Answer every seller
        </Button>
      </div>
    </form>
  );
}

/** The buyer's side: sellers' questions, with no names, and an answer box for those the AI left. */
export function BuyerQA({ questions, open }: { questions: PublishedQuestion[]; open: boolean }) {
  if (!open && questions.length === 0) return null;
  const waiting = questions.filter((q) => !q.answer).length;
  return (
    <Panel className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="text-base">Sellers&apos; questions</h2>
          <p className="text-xs text-muted">
            Who asked stays hidden, even from you, while bids are sealed. Every answer goes to every seller.
          </p>
        </div>
        {waiting > 0 && <Pill tone="warn">{waiting} waiting for you</Pill>}
      </div>
      {questions.length === 0 ? (
        <p className="text-sm text-muted">No questions yet. Your AI answers what the tender already settles; the rest comes to you here.</p>
      ) : (
        <ol className="grid divide-y divide-line border-y border-line">
          {questions.map((q) => (
            <li key={q.id} className="grid gap-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{q.question}</p>
                <span className="text-xs text-faint">A seller asked, {dayTime(q.askedAt)}</span>
              </div>
              {q.answer || !open ? <Answer q={q} /> : <AnswerBox q={q} />}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
