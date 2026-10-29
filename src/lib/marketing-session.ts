import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Visiteur connecté ? (une seule vérification par requête, jamais bloquant pour les pages publiques) */
export const isSignedIn = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return !!data?.claims;
  } catch {
    return false;
  }
});
