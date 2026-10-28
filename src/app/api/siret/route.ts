import { NextResponse, type NextRequest } from "next/server";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow, ipOrDeny } from "@/lib/rate-limit-server";
import { lookupSiret } from "@/lib/siret-lookup";
import { isValidSiret } from "@/lib/validation/auth";

export const dynamic = "force-dynamic";

/** Public (page d'inscription) : reconnaît une entreprise à partir de son SIRET. Débit limité, aucune donnée de compte. */
export async function GET(req: NextRequest) {
  const siret = (req.nextUrl.searchParams.get("siret") ?? "").replace(/\s/g, "");
  if (!isValidSiret(siret)) return NextResponse.json({ status: "invalid" }, { status: 400 });
  // IP inconnue en production : refus (pas de seau partagé exploitable pour épuiser les autres).
  const ip = await ipOrDeny();
  if (!ip) return NextResponse.json({ status: "unavailable", error: "Service momentanément indisponible." }, { status: 503 });
  if (!(await allow("siret", ip, RULES.siret))) return NextResponse.json({ status: "unavailable", error: RATE_LIMIT_MESSAGE }, { status: 429 });
  return NextResponse.json(await lookupSiret(siret), { headers: { "cache-control": "private, max-age=300" } });
}
