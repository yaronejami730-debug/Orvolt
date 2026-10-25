import "server-only";
import { canViewField, type CustomFieldDef } from "@/lib/custom-fields";
import { createClient } from "@/lib/supabase/server";
import { sessionCan, type AppSession } from "@/lib/session";
import type { LeadsMeta } from "./types";

/** Métadonnées nécessaires aux écrans leads (statuts, sources, membres, champs visibles, transitions). */
export async function loadLeadsMeta(s: AppSession): Promise<LeadsMeta> {
  const supabase = await createClient();
  const org = s.org.id;
  const [st, so, me, fi, tr, gr] = await Promise.all([
    supabase.from("statuses").select("id, name, color, kind, position, is_initial").eq("org_id", org).order("position"),
    supabase.from("lead_sources").select("id, name, archived").eq("org_id", org).order("created_at"),
    supabase.from("memberships").select("user_id").eq("org_id", org).eq("status", "active"),
    supabase.from("custom_fields").select("id, key, label, type, options, required, visible_roles, editable_roles").eq("org_id", org).order("position"),
    supabase.from("status_transitions").select("from_status_id, to_status_id, role_id").eq("org_id", org),
    supabase.from("status_role_grants").select("status_id, can_place, can_create").eq("org_id", org).eq("role_id", s.role.id),
  ]);
  const initialId = ((st.data ?? []) as { id: string; is_initial: boolean }[]).find((x) => x.is_initial)?.id;
  const allIds = ((st.data ?? []) as { id: string }[]).map((x) => x.id);
  const grants = gr.data ?? [];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", (me.data ?? []).map((m) => m.user_id));
  const ctx = { roleId: s.role.id, isAdmin: s.isAdmin };
  return {
    statuses: (st.data ?? []) as LeadsMeta["statuses"],
    sources: so.data ?? [],
    members: (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" })),
    fields: ((fi.data ?? []) as CustomFieldDef[]).filter((f) => canViewField(f, ctx)),
    transitions: (tr.data ?? []).map((t) => ({ from: t.from_status_id, to: t.to_status_id, role_id: t.role_id })),
    placeable: s.isAdmin ? allIds : grants.filter((g) => g.can_place).map((g) => g.status_id),
    creatable: s.isAdmin ? allIds : [...new Set([...(initialId ? [initialId] : []), ...grants.filter((g) => g.can_create).map((g) => g.status_id)])],
    roleId: s.role.id,
    isAdmin: s.isAdmin,
    userId: s.user.id,
    can: {
      create: sessionCan(s, "leads.create"),
      edit: sessionCan(s, "leads.edit"),
      delete: sessionCan(s, "leads.delete"),
      appointments: sessionCan(s, "appointments.manage_all") ? "all" : sessionCan(s, "appointments.manage_own") ? "own" : null,
    },
  };
}

/** Définitions complètes des champs (y compris non visibles) pour la validation serveur. */
export async function loadFieldDefs(orgId: string): Promise<CustomFieldDef[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("custom_fields").select("id, key, label, type, options, required, visible_roles, editable_roles").eq("org_id", orgId).order("position");
  return (data ?? []) as CustomFieldDef[];
}
