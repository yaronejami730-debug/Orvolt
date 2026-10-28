const isProd = process.env.NODE_ENV === "production";

/** Nonce aléatoire par requête (128 bits, base64). Compatible Edge (Web Crypto). */
export function makeNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * Content-Security-Policy à nonce : 'strict-dynamic' fait confiance aux seuls scripts portant le nonce (Next les marque
 * automatiquement en lisant cet en-tête) et à ceux qu'ils chargent ; plus de 'unsafe-inline' côté scripts.
 * style-src garde 'unsafe-inline' (attributs style de React/Radix/cartes) : risque limité, aucune exécution de code.
 */
export function buildCsp(nonce: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
  const supabaseWs = supabaseUrl.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    // 'self' + https: ne servent que de repli aux navigateurs sans 'strict-dynamic' (ignorés par les autres).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? "" : " 'unsafe-eval'"} https://js.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://api.stripe.com https://*.supabase.co wss://*.supabase.co${isProd ? "" : " ws://localhost:* ws://127.0.0.1:*"}`,
    "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
