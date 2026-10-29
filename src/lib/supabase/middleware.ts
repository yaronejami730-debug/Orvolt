import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_FLAGS } from "@/lib/supabase/cookie-flags";

const PUBLIC_EXACT = ["/", "/login", "/signup", "/forgot", "/reset", "/pricing", "/mentions-legales", "/confidentialite", "/cgv", "/contact", "/api/siret", "/sitemap.xml", "/robots.txt", "/opengraph-image", "/api/stripe/webhook",
  // Nouvelles pages marketing et fichiers SEO publics (liste alignée sur PUBLIC_PAGES / SEO_FILES de src/lib/site.ts, vérifiée par tests/unit/seo.test.ts).
  "/fonctionnalites", "/solutions/installateurs-energie", "/solutions/regies-prospection", "/llms.txt", "/manifest.webmanifest", "/apple-icon.png", "/icon.png"];
const PUBLIC_PREFIX = ["/design", "/lp/", "/api/webhooks/", "/api/cron/", "/api/relance/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIX.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, ...SESSION_COOKIE_FLAGS }));
      },
    },
  });

  // getClaims : signature du JWT vérifiée localement (clé publique ES256 du projet, mise en cache par le processus),
  // sans aller-retour vers le serveur Auth à chaque requête ; le jeton expiré est rafraîchi et les cookies réécrits.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;
  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
