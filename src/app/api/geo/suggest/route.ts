import { NextResponse } from "next/server";
import { safeFetch } from "@/lib/net/safe-fetch";
import { mockSuggest, suggestAddresses } from "@/lib/geo/resolve";
import { allow } from "@/lib/rate-limit-server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const UA = `LeadForgeCRM/1.0 (+${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"})`;

/**
 * Proxy d'autocomplétion d'adresse (Géoplateforme / BAN, sans clé). Réservé aux utilisateurs connectés, limité en débit.
 * Seul le texte saisi est transmis à l'API publique : aucune autre donnée personnelle.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!(await allow("geo-suggest", s.user.id, { limit: 60, windowMs: 60_000 })) ) return NextResponse.json({ error: "Trop de requêtes." }, { status: 429 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 3) return NextResponse.json({ suggestions: [] });
  if (process.env.GEOCODER === "mock") {
    if (process.env.NODE_ENV === "production" && process.env.E2E_ALLOW_MOCK_GEOCODER !== "1") return NextResponse.json({ error: "Mock interdit en production." }, { status: 500 });
    return NextResponse.json({ suggestions: mockSuggest(q) });
  }
  try {
    const suggestions = await suggestAddresses(q, (url) => safeFetch(url, { method: "GET", headers: { "user-agent": UA, accept: "application/json" }, timeoutMs: 4000, maxBytes: 200_000 }));
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [], unavailable: true });
  }
}
