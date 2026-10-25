import { NextResponse, type NextRequest } from "next/server";
import { processStripeEvent } from "@/lib/billing/process";
import { webhookVerifier } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
const MAX_BYTES = 1_000_000;
const TOLERANCE_SECONDS = 300;

/**
 * Webhook Stripe. Signature vérifiée sur le CORPS BRUT (stripe-signature, tolérance 5 min) avant tout traitement.
 * 400 signature/corps invalide, 200 traité ou déjà vu, 500 en cas d'échec (Stripe réessaie). Aucun secret n'est journalisé.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let event;
  try {
    event = webhookVerifier().webhooks.constructEvent(raw, signature, secret, TOLERANCE_SECONDS);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  try {
    const r = await processStripeEvent(event);
    return NextResponse.json({ received: true, result: r.result }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
