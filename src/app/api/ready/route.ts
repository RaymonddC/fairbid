import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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
      detail: process.env.ANTHROPIC_API_KEY ? "Live model." : "Scripted fixtures: ANTHROPIC_API_KEY is not set.",
    },
    {
      name: "paypal_webhook",
      ok: Boolean(process.env.PAYPAL_WEBHOOK_ID),
      critical: false,
      detail: process.env.PAYPAL_WEBHOOK_ID ? "Configured." : "PAYPAL_WEBHOOK_ID is not set, so webhooks are rejected.",
    },
  ];
  const ready = checks.every((check) => check.ok || !check.critical);
  return NextResponse.json({ ready, checks }, { status: ready ? 200 : 503 });
}
