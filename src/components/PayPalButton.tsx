"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "./Loading";

// The PayPal JS SDK, loaded on demand. The CSP in src/proxy.ts allows it: our own
// (nonce-trusted) script adds the tag, which 'strict-dynamic' lets through.

type Buttons = { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> };
type PayPalSdk = {
  Buttons: (opts: {
    style?: Record<string, string | number>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }) => Buttons;
};

declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

let loading: Promise<PayPalSdk> | null = null;

function loadSdk(currency: string): Promise<PayPalSdk> {
  if (window.paypal) return Promise.resolve(window.paypal);
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  if (!clientId) return Promise.reject(new Error("NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set."));
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?${new URLSearchParams({
      "client-id": clientId,
      currency,
      intent: "authorize",
      components: "buttons",
      "disable-funding": "paylater,credit",
    })}`;
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal did not load.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("PayPal could not be reached. Check your connection and reload."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * PayPal's own button. `createOrder` asks our server for an order (the seller as payee);
 * the buyer approves in PayPal's window; `onApprove` asks our server to authorize it.
 */
export function PayPalButton({
  currency,
  createOrder,
  onApprove,
  successMessage,
}: {
  currency: string;
  createOrder: () => Promise<{ ok: true; orderId: string } | { ok: false; error: string }>;
  onApprove: (orderId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Toast shown once PayPal has placed the hold. */
  successMessage: [string, string];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "working">("loading");
  const [error, setError] = useState<string | null>(null);
  // The latest callbacks, so the rendered button never calls a stale one.
  const calls = useRef({ createOrder, onApprove, successMessage });
  useEffect(() => {
    calls.current = { createOrder, onApprove, successMessage };
  });

  useEffect(() => {
    let buttons: Buttons | null = null;
    let gone = false;
    loadSdk(currency)
      .then((paypal) => {
        if (gone || !box.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 44 },
          createOrder: async () => {
            setError(null);
            const r = await calls.current.createOrder();
            if (!r.ok) {
              setError(r.error);
              toast.error("PayPal could not start", { description: r.error, duration: 9000 });
              throw new Error(r.error);
            }
            return r.orderId;
          },
          onApprove: async ({ orderID }) => {
            setState("working");
            const r = await calls.current.onApprove(orderID);
            if (!r.ok) {
              setError(r.error);
              setState("ready");
              toast.error("The hold was not placed", { description: r.error, duration: 9000 });
            } else {
              const [title, description] = calls.current.successMessage;
              toast.success(title, { description });
            }
          },
          onCancel: () => {
            setError("You closed PayPal before approving, so nothing is held. Try again when you are ready.");
            toast("Nothing was held", { description: "You closed PayPal before approving." });
          },
          onError: () => setError((e) => e ?? "PayPal stopped with an error. Nothing was charged. Try again."),
        });
        return buttons.render(box.current).then(() => !gone && setState("ready"));
      })
      .catch((e: Error) => {
        if (!gone) setError(e.message);
      });
    return () => {
      gone = true;
      buttons?.close?.().catch(() => {});
    };
  }, [currency]);

  return (
    <div className="grid gap-2">
      {state !== "ready" && !error && (
        <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <Spinner size={15} label="Loading" />
          {state === "working" ? "Placing the hold with PayPal…" : "Loading PayPal…"}
        </p>
      )}
      <div ref={box} className={state === "working" ? "pointer-events-none opacity-50" : ""} />
      {error && (
        <p role="alert" className="rounded-lg bg-flag-soft p-3 text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  );
}
