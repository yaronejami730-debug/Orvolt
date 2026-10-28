import { NextResponse, type NextRequest } from "next/server";
import { syncPremiumPrices } from "@/lib/billing/premium";
import { getStripe } from "@/lib/billing/stripe";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Tâche quotidienne : met à jour le prix des abonnements Premium au palier d'ancienneté de la prochaine facture. */
async function handle(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  return NextResponse.json({ ok: true, report: await syncPremiumPrices(stripe) }, { headers: { "cache-control": "no-store" } });
}
export const GET = handle;
export const POST = handle;
