"use client";

import { useState, useTransition } from "react";
import { linkChannelAction, unlinkChannelAction } from "@/app/actions";
import type { LinkOffer } from "@/lib/channels";
import { notifyError, notifySuccess } from "./ActionButton";
import { Button, Panel, Pill } from "./ui";

type Row = { kind: string; label: string; linked: string | null };

/** Lets a seller also receive clarification questions in a chat. Optional: the inbox always works. */
export function ChannelLinker({ channels }: { channels: Row[] }) {
  if (channels.length === 0) return null;
  return (
    <Panel className="grid content-start gap-4">
      <div className="grid gap-0.5">
        <h2 className="text-base">Get questions in your chat</h2>
        <p className="text-sm text-muted">
          Optional. A buyer&apos;s question also arrives in the chat you link, and your reply there is recorded exactly like one typed in the
          inbox. The inbox keeps working either way.
        </p>
      </div>
      <ul className="grid gap-4">
        {channels.map((c) => (
          <ChannelRow key={c.kind} row={c} />
        ))}
      </ul>
    </Panel>
  );
}

function ChannelRow({ row }: { row: Row }) {
  const [offer, setOffer] = useState<LinkOffer | null>(null);
  const [pending, start] = useTransition();

  const link = () =>
    start(async () => {
      const r = await linkChannelAction(row.kind);
      if (r.ok) setOffer(r.offer);
      else notifyError(r.error);
    });
  const unlink = () =>
    start(async () => {
      const r = await unlinkChannelAction(row.kind);
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
