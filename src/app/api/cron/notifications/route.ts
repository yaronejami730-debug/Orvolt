import { NextResponse, type NextRequest } from "next/server";
import { runNotifications } from "@/lib/notifications/cron";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, report: await runNotifications() }, { headers: { "cache-control": "no-store" } });
}
export const GET = handle;
export const POST = handle;
