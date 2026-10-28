import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildCsp, makeNonce } from "@/lib/csp";
import { NOINDEX_PAGES, isPrivatePath } from "@/lib/site";

export async function middleware(request: NextRequest) {
  // CSP à nonce par requête : transmise à Next (rendu serveur) via les en-têtes de requête, et au navigateur via la réponse.
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", csp);
  // Pages d'auth : jamais en cache (jeton de réinitialisation dans l'URL, formulaires, redirections de session).
  const p = request.nextUrl.pathname;
  // SEO : zones privées, API et pages sans valeur de référencement sont exclues de l'index (robots.txt seul n'empêcherait pas l'indexation des URL).
  if (isPrivatePath(p) || NOINDEX_PAGES.includes(p)) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (["/login", "/signup", "/forgot", "/reset"].includes(p)) response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)"],
};
