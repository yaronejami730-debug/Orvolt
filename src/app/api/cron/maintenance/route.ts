import { NextResponse, type NextRequest } from "next/server";
import { runMaintenance } from "@/lib/maintenance";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, report: await runMaintenance() }, { headers: { "cache-control": "no-store" } });
}
export const GET = handle;
export const POST = handle;
