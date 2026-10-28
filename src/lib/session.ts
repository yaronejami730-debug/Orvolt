import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can as canPerm, resolvePermissions, type Permission } from "@/lib/permissions";

export const ORG_COOKIE = "lf_org";
export const ORG_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30, // 30 jours (préférence d'organisation active, revalidée côté serveur à chaque requête)
};

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  template: string;
  plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  seat_limit: number | null;
  /** Régie maître (null = organisation indépendante ou maître). */
  parent_org_id: string | null;
  org_type: "installer" | "agency" | null;
  /** null = onboarding en cours (accès à l'application bloqué jusqu'à son terme). */
  onboarded_at: string | null;
}
export interface RoleSummary {
  id: string;
  name: string;
  is_admin: boolean;
  is_system: boolean;
  /** Rôle terrain (commercial) : seul à avoir une zone et à recevoir des RDV répartis. */
  is_field: boolean;
  permissions: string[];
}
export interface AppSession {
  user: { id: string; email: string };
  profile: { full_name: string | null; email: string | null; avatar_url: string | null };
  org: OrgSummary;
  orgs: OrgSummary[];
  membership: { id: string; org_id: string; role_id: string };
  role: RoleSummary;
  permissions: Permission[];
  isAdmin: boolean;
}

interface MembershipRow {
  id: string;
  org_id: string;
  role_id: string;
  organization: OrgSummary | null;
  role: RoleSummary | null;
}

const ORG_COLS = "id, name, slug, template, plan, subscription_status, trial_ends_at, seat_limit, parent_org_id, org_type, onboarded_at";

/** Session applicative (utilisateur + org active + rôle + permissions). Mise en cache par requête. */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: rows }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select(`id, org_id, role_id, organization:organizations(${ORG_COLS}), role:roles(id, name, is_admin, is_system, is_field, permissions)`)
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("full_name, email, avatar_url").eq("id", user.id).maybeSingle(),
  ]);

  const memberships = ((rows ?? []) as unknown as MembershipRow[]).filter((m) => m.organization && m.role);
  if (memberships.length === 0) return null;

  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const current = memberships.find((m) => m.org_id === wanted) ?? memberships[0]!;
  const role = current.role!;
  return {
    user: { id: user.id, email: user.email ?? "" },
    profile: profile ?? { full_name: null, email: user.email ?? null, avatar_url: null },
    org: current.organization!,
    orgs: memberships.map((m) => m.organization!),
    membership: { id: current.id, org_id: current.org_id, role_id: current.role_id },
    role,
    permissions: resolvePermissions(role.is_admin, role.permissions),
    isAdmin: role.is_admin,
  };
});

/** Redirige vers /login (non connecté) ou /no-access (aucune organisation active). */
export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (session) return session;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/no-access" : "/login");
}

export function sessionCan(session: AppSession, perm: Permission): boolean {
  return canPerm(session.permissions, perm, session.isAdmin);
}
