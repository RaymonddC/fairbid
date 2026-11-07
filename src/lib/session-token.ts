// Session cookie: "<user id>.<expiry ms>.<HMAC>". Without the signature anyone
// could write another user's id into the cookie and act as them. The expiry is
// signed too, so an old value copied elsewhere still stops working.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function sessionKey(): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET is not set. Generate one with `openssl rand -base64 32`.");
  return key;
}

const sign = (payload: string) => createHmac("sha256", sessionKey()).update(payload).digest("base64url");

export function signSession(userId: string, expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000): string {
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** The user id if the signature matches and it has not expired, else null.
 * Callers must treat null as "no session" and never fall back to the raw value. */
export function verifySession(value: string | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!userId || !Number.isFinite(expiresAt) || now > expiresAt) return null;
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(`${userId}.${expiresAtRaw}`));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
