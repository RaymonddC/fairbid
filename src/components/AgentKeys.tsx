"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createAgentKeyAction, revokeAgentKeyAction } from "@/app/actions";
import type { AgentKeyView } from "@/lib/mcp/agent-keys";
import { notifyError, notifySuccess } from "./ActionButton";
import { Button, Panel, Pill } from "./ui";

const input =
  "min-h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-dye focus:ring-2 focus:ring-dye/15";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Lets a seller give their own AI agent (Claude, or any MCP client) a key to FairBid. */
export function AgentKeys({ keys, mcpUrl, bare = false }: { keys: AgentKeyView[]; mcpUrl: string; bare?: boolean }) {
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const r = await createAgentKeyAction(label);
      if (r.ok) {
        setFresh({ key: r.key, label: r.view.label });
        setLabel("");
      } else notifyError(r.error);
    });
  const revoke = (k: AgentKeyView) => {
    if (!window.confirm(`Revoke "${k.label}"? Any agent using it stops working at once.`)) return;
    start(async () => {
      const r = await revokeAgentKeyAction(k.id);
      if (r.ok) notifySuccess(`Key "${k.label}" revoked`);
      else notifyError(r.error);
    });
  };
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => notifySuccess("Copied"),
      () => notifyError("Copy failed. Select the text and copy it yourself."),
    );

  const command = fresh ? `claude mcp add --transport http fairbid ${mcpUrl} --header "Authorization: Bearer ${fresh.key}"` : "";

  const body = (
    <>
      <div className="grid gap-0.5">
        {!bare && <h2 className="text-base">Let your AI agent bid for you</h2>}
        <p className="text-sm text-muted">
          Optional. Give an AI agent, such as Claude, a key and it can find open tenders, seal bids and answer buyers&apos; questions for you,
          under the same rules as this site: bids stay sealed, no late bids, and an answer never changes a price.{" "}
          <Link href="/agents" className="font-medium text-dye underline underline-offset-4">
            How it works
          </Link>
        </p>
      </div>

      {keys.length > 0 && (
        <ul className="grid gap-2">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{k.label}</span>
              <code className="font-mono text-xs text-muted">{k.prefix}…</code>
              <Pill tone={k.lastUsedAt ? "ok" : "plain"}>{k.lastUsedAt ? `Last used ${when(k.lastUsedAt)}` : "Not used yet"}</Pill>
              <span className="text-xs text-faint">Made {when(k.createdAt)}</span>
              <Button variant="danger" loading={pending} onClick={() => revoke(k)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          <span className="font-medium">Name the agent</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Claude on my laptop" className={input} />
        </label>
        <Button type="submit" variant="secondary" loading={pending} disabled={!label.trim()}>
          Make a key
        </Button>
      </form>

      {fresh && (
        <div className="grid gap-3 rounded-lg bg-canvas px-4 py-3 text-sm" role="status">
          <p>
            <strong className="font-semibold">Copy this key now.</strong> It is shown only once; FairBid keeps only a fingerprint of it. Anyone
            with the key can bid as you, so keep it private, and revoke it here if it leaks.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-surface px-2 py-1 font-mono text-xs ring-1 ring-line">{fresh.key}</code>
            <Button variant="secondary" onClick={() => copy(fresh.key)}>
              Copy key
            </Button>
          </div>
          <p className="text-muted">To connect Claude Code, run:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-surface px-2 py-1 font-mono text-xs ring-1 ring-line">{command}</code>
            <Button variant="secondary" onClick={() => copy(command)}>
              Copy command
            </Button>
          </div>
          <p className="text-muted">
            Other agents: see{" "}
            <Link href="/agents" className="font-medium text-dye underline underline-offset-4">
              Connect an AI agent
            </Link>
            .
          </p>
          <button type="button" onClick={() => setFresh(null)} className="justify-self-start text-sm font-medium text-muted underline underline-offset-4 hover:text-ink">
            I have saved it
          </button>
        </div>
      )}
    </>
  );
  // Bare: shown inside the FairBid agent panel, under "Use your own agent instead".
  return bare ? <div className="grid content-start gap-4">{body}</div> : <Panel className="grid content-start gap-4">{body}</Panel>;
}
