import { NextResponse, type NextRequest } from "next/server";
import { firstDelivery, forgetDelivery, handleInbound } from "@/lib/channels";
import { twiml, verifyTwilioSignature, whatsappChannel } from "@/lib/channels/whatsapp";
import { log } from "@/lib/log";
import { createLimiter } from "@/lib/rate-limit";

const bySender = createLimiter(30, 60_000);
const xml = (body: string, status = 200) => new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });

/** Twilio posts each inbound WhatsApp message here as a form. The signature covers the
 * public URL, so it is rebuilt from PUBLIC_BASE_URL, not from the request: Cloud Run
 * terminates TLS and the request URL would not match what Twilio signed. */
export async function POST(req: NextRequest) {
  const params = new URLSearchParams(await req.text());
  const url = process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/webhooks/whatsapp` : undefined;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), process.env.TWILIO_AUTH_TOKEN, url, params)) {
    log.warn("whatsapp webhook rejected");
    return NextResponse.json({ error: { code: "bad_signature", message: "Signature not verified." } }, { status: 401 });
  }
  const msg = whatsappChannel.parseInbound(params);
  if (!msg) return xml("<Response/>");
  if (!bySender.hit(msg.address)) return xml("<Response/>");

  const id = `whatsapp:${msg.externalId}`;
  if (!(await firstDelivery(id, "whatsapp.message"))) return xml("<Response/>");
  try {
    return xml(twiml((await handleInbound(msg))?.text ?? ""));
  } catch (error) {
    log.error("whatsapp message failed", error);
    await forgetDelivery(id);
    return NextResponse.json({ error: { code: "processing_failed", message: "Try again." } }, { status: 500 });
  }
}
