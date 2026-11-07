import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/session-token";

// PayPal's buttons load a script and open frames from these origins. Without
// them the CSP blocks the buttons, and they simply never appear.
const PAYPAL = "https://www.paypal.com https://www.sandbox.paypal.com";

function buildCsp(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${PAYPAL}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https://www.paypalobjects.com ${PAYPAL}`,
    "font-src 'self'",
    `connect-src 'self' ${PAYPAL}`,
    `frame-src ${PAYPAL}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Reached by machines or before login. Each one checks its own credentials.
const PUBLIC_PATH = /^\/(login$|api\/(health|ready|mcp|webhooks)(\/|$))/;

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  if (!PUBLIC_PATH.test(pathname) && verifySession(raw) === null) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    const res = NextResponse.redirect(url);
    res.headers.set("Content-Security-Policy", csp);
    if (raw) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
