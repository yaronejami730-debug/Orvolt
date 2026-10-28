import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "@/lib/templates";

/** Domaines d'appel créés avec le modèle énergie. */
export const DEFAULT_ENERGY_DOMAINS = [{ name: "Pompe à chaleur", color: "#f97316" }, { name: "Photovoltaïque", color: "#eab308" }];

export type ApplyResult = { ok: true } | { ok: false; error: string };

/**
 * Applique un template à une organisation (statuts, transitions, actions, champs, sources).
 * Idempotent : remplace la configuration existante. Refuse si l'org possède des leads.
 */
export async function applyTemplate(orgId: string, templateId: string): Promise<ApplyResult> {
  const tpl = getTemplate(templateId);
  if (!tpl) return { ok: false, error: "Template inconnu." };
  const admin = createAdminClient();

  const { data: roles, error: rolesError } = await admin.from("roles").select("id, name").eq("org_id", orgId);
  if (rolesError || !roles?.length) return { ok: false, error: "Rôles introuvables." };
  const roleId = (name: string) => roles.find((r) => r.name === name)?.id;

  const payload = {
    statuses: tpl.statuses,
    transitions: tpl.transitions.map((t) => ({
      from: t.from,
      to: t.to,
      roles: t.roles === "all" ? null : [...new Set([...t.roles.map(roleId), roleId("Administrateur")].filter(Boolean))],
    })),
    actions: tpl.actions.map((a) => {
      const { roleName, ...rest } = a.config as Record<string, unknown> & { roleName?: string };
      const config = roleName ? { ...rest, roleId: roleId(roleName) } : rest;
      return { status: a.status, type: a.type, config, enabled: a.enabled };
    }),
    fields: tpl.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.type === "select" ? { choices: f.choices ?? [], multiple: f.multiple ?? false } : {},
      visible_roles: null,
      editable_roles: null,
    })),
    sources: [
      ...tpl.sources.map((s) => ({ name: s.name, color: s.color ?? null, is_default: true, is_system: false })),
      { name: "Import CSV", color: null, is_default: false, is_system: true },
      { name: "Webhook", color: null, is_default: false, is_system: true },
    ],
  };
  const { error } = await admin.rpc("apply_template_payload", { org: orgId, payload });
  if (error) {
    if (process.env.NODE_ENV !== "production") console.error("[applyTemplate]", error.message);
    return { ok: false, error: error.message.includes("org_has_leads") ? "L'organisation contient déjà des leads." : "Application du template impossible." };
  }
  await admin.from("organizations").update({ template: tpl.id }).eq("id", orgId);
  // Modèle « énergie » : domaines d'appel par défaut (modifiables / supprimables ensuite). Seulement si l'organisation n'en a aucun.
  if (tpl.id === "energie") {
    const { count } = await admin.from("call_domains").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    if (!count) await admin.from("call_domains").insert(DEFAULT_ENERGY_DOMAINS.map((d, position) => ({ org_id: orgId, name: d.name, color: d.color, position })));
  }
  return { ok: true };
}
