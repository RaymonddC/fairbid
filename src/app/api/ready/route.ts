import { NextResponse } from "next/server";
import { aiEnabled } from "@/lib/ai/model";
import { aiLocation, aiModel } from "@/lib/ai-config";
import { CHANNELS } from "@/lib/channels/registry";
import { db } from "@/lib/db";
import { dutyLookupEnabled } from "@/lib/duty-lookup";
import { createPayPalClient, loadConfig } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

type Check = { name: string; ok: boolean; critical: boolean; detail: string };

async function checkDatabase(): Promise<Check> {
  try {
    const count = await db.tender.count();
    return count > 0
      ? { name: "database", ok: true, critical: true, detail: `${count} tender(s).` }
      : { name: "database", ok: false, critical: true, detail: "Connected but empty. Run `npm run db:seed`." };
  } catch {
    return {
      name: "database",
      ok: false,
      critical: true,
      detail: "Cannot read tenders. Check DATABASE_URL, then run `npm run db:migrate`.",
    };
  }
}

async function checkPayPal(): Promise<Check> {
  try {
    await createPayPalClient(loadConfig()).accessToken();
    return { name: "paypal", ok: true, critical: true, detail: "Sandbox token issued." };
  } catch {
    return {
      name: "paypal",
      ok: false,
      critical: true,
      detail: "No sandbox token. Check PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID and PAYPAL_SECRET.",
    };
  }
}

/** Says what is wrong and what to do about it. Holds no secrets or connection
 * strings, because it is unauthenticated. */
export async function GET() {
  const checks: Check[] = [
    await checkDatabase(),
    await checkPayPal(),
    {
      name: "llm",
      ok: true,
      critical: false,
      detail: aiEnabled() ? `Live model: ${aiModel()} on Vertex AI (${aiLocation()}).` : "Scripted fixtures: GOOGLE_CLOUD_PROJECT is not set.",
    },
    {
      name: "paypal_webhook",
      ok: Boolean(process.env.PAYPAL_WEBHOOK_ID),
      critical: false,
      detail: process.env.PAYPAL_WEBHOOK_ID ? "Configured." : "PAYPAL_WEBHOOK_ID is not set, so webhooks are rejected.",
    },
    {
      name: "duty_rates",
      ok: dutyLookupEnabled(),
      critical: false,
      detail: dutyLookupEnabled()
        ? "Easyship lookup on: each bid's duty rate is checked for its code and country of origin."
        : 'EASYSHIP_TOKEN is not set, so bids are priced on seeded rates, marked "borrowed" (DEPLOY.md, "Duty rates").',
    },
    // Optional extras, so never critical: the in-app inbox works without them.
    ...Object.values(CHANNELS).map((c) => ({
      name: `channel_${c.kind}`,
      ok: c.configured(),
      critical: false,
      detail: c.configured() ? "Configured." : `${c.label} is off: its settings are not all set (DEPLOY.md, "Message channels").`,
    })),
  ];
  const ready = checks.every((check) => check.ok || !check.critical);
  return NextResponse.json({ ready, checks }, { status: ready ? 200 : 503 });
}
