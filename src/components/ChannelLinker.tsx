"use client";

import { useState, useTransition } from "react";
import { linkBuyerChannelAction, linkChannelAction, unlinkBuyerChannelAction, unlinkChannelAction } from "@/app/actions";
import type { LinkOffer } from "@/lib/channels";
import { notifyError, notifySuccess } from "./ActionButton";
import { Button, Panel, Pill } from "./ui";

type Row = { kind: string; label: string; linked: string | null };
type Audience = "seller" | "buyer";

const ACTIONS = {
  seller: { link: linkChannelAction, unlink: unlinkChannelAction },
  buyer: { link: linkBuyerChannelAction, unlink: unlinkBuyerChannelAction },
} as const;

/** Lets a seller receive clarification questions in a chat, or a buyer get tender updates.
 * Optional: the app always works without it. */
export function ChannelLinker({ channels, audience = "seller" }: { channels: Row[]; audience?: Audience }) {
  if (channels.length === 0) return null;
  return (
    <Panel className="grid content-start gap-4">
      <div className="grid gap-0.5">
        <h2 className="text-base">Run it from Telegram</h2>
        {audience === "buyer" ? (
          <p className="text-sm text-muted">
            Optional. New sealed bids (the count only), bidders&apos; questions and your agent&apos;s answers arrive in the chat. Reply to a question to
            answer every bidder, tap /tenders to sum up or close bidding, or just ask your agent how a tender is going.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Optional. New tenders, your agent&apos;s summaries and tender owners&apos; questions arrive in the chat. Tap /open to let your agent bid
            or to ask a question, reply to a question to answer it, or just ask your agent how your bids are going.
          </p>
        )}
      </div>
      <ul className="grid gap-4">
        {channels.map((c) => (
          <ChannelRow key={c.kind} row={c} audience={audience} />
        ))}
      </ul>
    </Panel>
  );
}

function ChannelRow({ row, audience }: { row: Row; audience: Audience }) {
  const [offer, setOffer] = useState<LinkOffer | null>(null);
  const [pending, start] = useTransition();

  const link = () =>
    start(async () => {
      const r = await ACTIONS[audience].link(row.kind);
      if (r.ok) setOffer(r.offer);
      else notifyError(r.error);
    });
  const unlink = () =>
    start(async () => {
      const r = await ACTIONS[audience].unlink(row.kind);
      if (r.ok) {
        setOffer(null);
        notifySuccess(`${row.label} unlinked`);
      } else notifyError(r.error);
    });

  return (
    <li className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{row.label}</span>
        {row.linked ? <Pill tone="ok">Linked to {row.linked}</Pill> : <Pill>Not linked</Pill>}
        <Button variant="secondary" loading={pending} onClick={link}>
          {row.linked ? "Link another chat" : "Link"}
        </Button>
        {row.linked && (
          <Button variant="danger" loading={pending} onClick={unlink}>
            Unlink
          </Button>
        )}
      </div>
      {offer && (
        <div className="grid gap-1 rounded-lg bg-canvas px-4 py-3 text-sm">
          {offer.url && (
            <a href={offer.url} target="_blank" rel="noreferrer" className="font-medium text-dye underline underline-offset-4">
              Open {row.label} to finish linking
            </a>
          )}
          <p className="text-muted">
            {row.kind === "telegram" ? "Or send the bot" : "Or send the sandbox number"}{" "}
            <code className="font-mono text-ink">{row.kind === "telegram" ? `/start ${offer.code}` : `link ${offer.code}`}</code>. The code works once, for{" "}
            {offer.expiresInMinutes} minutes.
          </p>
        </div>
      )}
    </li>
  );
}
