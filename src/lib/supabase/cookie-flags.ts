/** Cookies de session : illisibles par le JavaScript (le navigateur n'utilise pas de client Supabase), HTTPS en production. */
export const SESSION_COOKIE_FLAGS = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" };
