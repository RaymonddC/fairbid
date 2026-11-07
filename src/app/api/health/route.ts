import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness. Deliberately shallow: a database blip must not restart the service.
 * /api/ready says whether dependencies actually work. */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
