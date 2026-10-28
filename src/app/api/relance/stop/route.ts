import { NextResponse, type NextRequest } from "next/server";
import { orgTokenValid } from "@/lib/email-verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const page = (title: string, body: string, status = 200) => new NextResponse(
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="margin:0;background:#f9fafb;font-family:system-ui,sans-serif;color:#0f1521"><main style="max-width:480px;margin:12vh auto;padding:0 20px"><h1 style="font-size:22px">${title}</h1>${body}</main></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

function params(req: NextRequest) {
  const o = req.nextUrl.searchParams.get("o") ?? "", t = req.nextUrl.searchParams.get("t") ?? "";
  try { return UUID.test(o) && t && orgTokenValid("relance", o, t) ? { o, t } : null; } catch { return null; }
}
const invalid = () => page("Lien invalide", "<p>Ce lien de désinscription n'est pas valide.</p>", 400);

/** GET : simple confirmation (un scanner de liens de messagerie ne désinscrit personne par erreur). */
export function GET(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();
  return page("Ne plus recevoir ces rappels ?", `<p>Vous ne recevrez plus de rappel concernant l'inscription de votre espace ${SITE_NAME}.</p><form method="post" action="/api/relance/stop?o=${p.o}&t=${p.t}"><button type="submit" style="height:44px;padding:0 28px;border:0;border-radius:32px;background:#0f1521;color:#f9fafb;font-size:14px;font-weight:600;cursor:pointer">Confirmer</button></form>`);
}

/** POST : enregistre la désinscription (aucune connexion requise, jeton signé lié à l'organisation). */
export async function POST(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();
  const { error } = await createAdminClient().from("organizations").update({ reminders_optout_at: new Date().toISOString() }).eq("id", p.o).is("reminders_optout_at", null);
  if (error) return page("Désinscription impossible", "<p>Une erreur est survenue. Réessayez dans un instant.</p>", 500);
  return page("C'est noté", "<p>Vous ne recevrez plus de rappel d'inscription.</p>");
}
