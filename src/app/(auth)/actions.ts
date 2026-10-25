"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, firstError, loginSchema, signupSchema } from "@/lib/validation/auth";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow, clientIp } from "@/lib/rate-limit-server";
import { applyTemplate } from "@/lib/apply-template";
import { ORG_COOKIE, ORG_COOKIE_OPTIONS } from "@/lib/session";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  fieldValues?: Record<string, string>;
}

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) return { error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error), fieldValues: { email: str(fd, "email") } };
  if (!(await allow("login", `${(await clientIp()) ?? "unknown"}:${parsed.data.email}`, RULES.login))) return { error: RATE_LIMIT_MESSAGE, fieldValues: { email: parsed.data.email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "E-mail ou mot de passe incorrect.", fieldValues: { email: parsed.data.email } };
  redirect("/dashboard");
}

export async function signupAction(_: FormState, fd: FormData): Promise<FormState> {
  const raw = {
    fullName: str(fd, "fullName"),
    email: str(fd, "email"),
    password: str(fd, "password"),
    orgName: str(fd, "orgName"),
    template: str(fd, "template"),
  };
  const keep = { fullName: raw.fullName, email: raw.email, orgName: raw.orgName, template: raw.template };
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return { error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error), fieldValues: keep };
  const ip = await clientIp();
  if (!(await allow("signup", ip ?? "global", ip ? RULES.signup : RULES.signupGlobal))) return { error: RATE_LIMIT_MESSAGE, fieldValues: keep };
  const { fullName, email, password, orgName, template } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error || !data.user) {
    const taken = error?.message.toLowerCase().includes("already");
    // Énumération de comptes : message volontairement neutre ; l'UX « e-mail déjà pris » est sacrifiée.
    void taken;
    return { error: "Inscription impossible avec ces informations. Si vous avez déjà un compte, connectez-vous.", fieldValues: keep };
  }
  if (!data.session) {
    return { error: "Confirmation par e-mail requise : vérifiez votre boîte de réception.", fieldValues: keep };
  }

  const { data: orgId, error: rpcError } = await supabase.rpc("create_organization", { p_name: orgName, p_template: template });
  if (rpcError || !orgId) {
    // Nettoyage : évite un compte orphelin sans organisation.
    await createAdminClient().auth.admin.deleteUser(data.user.id);
    await supabase.auth.signOut();
    const capped = rpcError?.message.includes("org_limit_reached");
    return { error: capped ? "Limite d'organisations atteinte." : "Création de l'entreprise impossible. Réessayez.", fieldValues: keep };
  }
  (await cookies()).set(ORG_COOKIE, orgId as string, ORG_COOKIE_OPTIONS);
  // Échec non bloquant : l'écran d'onboarding propose de réessayer.
  await applyTemplate(orgId as string, template);
  redirect("/onboarding");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ORG_COOKIE);
  redirect("/login");
}
