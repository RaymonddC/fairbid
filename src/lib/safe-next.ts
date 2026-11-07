/** The same-site path to return to after login, or "/". Browsers treat a backslash
 * like a slash, so "/\evil.example" would otherwise leave the site. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
