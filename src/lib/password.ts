// Password hashing with scrypt from node:crypto, so no extra dependency. Stored as
// "scrypt$<salt>$<hash>" (base64url). Pure apart from randomness, so it is tested directly.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
// N=16384, r=8, p=1: the Node default cost, well under a second per check.
const COST = { N: 16_384, r: 8, p: 1 } as const;

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, COST);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** True only for the right password. Malformed stored values never match. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltB64, "base64url"), KEY_LENGTH, COST);
  return timingSafeEqual(actual, expected);
}

/** A hash to check against when the email is unknown, so a wrong email and a wrong
 * password take the same time and give the same answer. */
export const DUMMY_HASH = hashPassword("not-a-real-password", Buffer.alloc(16, 7));
