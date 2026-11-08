import { headers } from "next/headers";

/** The site's public address, for showing people (docs, copy-paste setup). Prefers
 * PUBLIC_BASE_URL; falls back to the request's host, which is fine for display only,
 * never for anything a secret is sent to. */
export async function publicBaseUrl(): Promise<string> {
  const set = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (set) return set;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
