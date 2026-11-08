// Points the Telegram bot at this app's webhook, with the secret Telegram will echo back.
// Run once after the first deploy, and again if the URL or secret changes:
//   npm run channels:telegram -- set      (reads PUBLIC_BASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET)
//   npm run channels:telegram -- info     (shows what Telegram has registered)
// Prints no secret.

const [, , cmd = "info"] = process.argv;
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");

async function call(method: string, body?: object) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as { ok: boolean; description?: string; result?: unknown };
}

if (cmd === "set") {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!base || !base.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must be the public https URL.");
  if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET must be 16-256 characters of A-Z a-z 0-9 _ -.");
  const r = await call("setWebhook", { url: `${base}/api/webhooks/telegram`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
  console.log(r.ok ? `Webhook set to ${base}/api/webhooks/telegram` : `Telegram refused: ${r.description}`);
} else {
  const r = await call("getWebhookInfo");
  console.log(JSON.stringify(r.result, null, 2));
}
export {};
