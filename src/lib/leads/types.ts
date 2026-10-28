import type { CustomFieldDef } from "@/lib/custom-fields";

export interface LeadRow {
  id: string;
  status_id: string;
  source_id: string | null;
  assigned_to: string | null;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  value: number | null;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  position: number;
  created_by: string | null;
  /** Domaine d'activité du lead (pompe à chaleur, photovoltaïque…) : oriente le formulaire d'appel proposé. */
  call_domain_id?: string | null;
}
export const LEAD_COLS =
  "id, status_id, source_id, assigned_to, first_name, last_name, company, email, phone, address, city, postal_code, value, custom, created_at, updated_at, position, created_by, call_domain_id";

export interface MetaStatus { id: string; name: string; color: string; kind: "normal" | "won" | "lost"; position: number; is_initial: boolean }
export interface LeadsMeta {
  statuses: MetaStatus[];
  sources: { id: string; name: string; archived: boolean }[];
  members: { id: string; name: string }[];
  /** Domaines d'activité actifs (liste de saisie du lead) ; vide si l'organisation n'en a pas. */
  callDomains: { id: string; name: string }[];
  fields: CustomFieldDef[];
  transitions: { from: string; to: string; role_id: string | null }[];
  /** Statuts que le rôle de l'utilisateur peut poser / utiliser à la création (programmés par le super administrateur). */
  placeable: string[];
  creatable: string[];
  roleId: string;
  isAdmin: boolean;
  userId: string;
  can: { create: boolean; edit: boolean; delete: boolean; appointments: "all" | "own" | null };
}

export function leadName(l: Pick<LeadRow, "first_name" | "last_name" | "company">): string {
  return `${l.first_name} ${l.last_name}`.trim() || l.company || "Sans nom";
}

/** Règle côté client (indicative) : l'autorité reste le serveur / la base. */
export function canMoveClient(meta: LeadsMeta, from: string, to: string): boolean {
  if (from === to) return true;
  const src = meta.statuses.find((s) => s.id === from);
  if (!src || src.kind !== "normal") return false;
  if (meta.isAdmin) return true;
  if (!meta.placeable.includes(to)) return false;
  return meta.transitions.some((t) => t.from === from && t.to === to && (t.role_id === null || t.role_id === meta.roleId));
}
