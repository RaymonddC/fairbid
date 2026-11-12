/** A page on the site, for a link button in a chat. Null without a public address. */
export function siteUrl(path: string): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}${path}` : null;
}
