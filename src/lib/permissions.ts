/** Catalogue de permissions. Miroir de la contrainte `roles_permissions_known` en SQL. */
export const PERMISSIONS = [
  "leads.view_all",
  "leads.view_own",
  "leads.create",
  "leads.edit",
  "leads.delete",
  "leads.import",
  "statuses.manage",
  "fields.manage",
  "roles.manage",
  "members.manage",
  "appointments.manage_all",
  "appointments.manage_own",
  "dashboard.view",
  "billing.manage",
  "settings.manage",
  "dispatch.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "leads.view_all": "Voir tous les leads",
  "leads.view_own": "Voir ses propres leads",
  "leads.create": "Créer des leads",
  "leads.edit": "Modifier des leads",
  "leads.delete": "Supprimer des leads",
  "leads.import": "Importer des leads",
  "statuses.manage": "Gérer les statuts",
  "fields.manage": "Gérer les champs personnalisés",
  "roles.manage": "Gérer les rôles",
  "members.manage": "Gérer les membres",
  "appointments.manage_all": "Gérer tous les rendez-vous",
  "appointments.manage_own": "Gérer ses rendez-vous",
  "dashboard.view": "Voir le tableau de bord",
  "billing.manage": "Gérer la facturation",
  "settings.manage": "Gérer les paramètres",
  "dispatch.manage": "Répartir les rendez-vous automatiquement",
};

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: "Leads",
    permissions: ["leads.view_all", "leads.view_own", "leads.create", "leads.edit", "leads.delete", "leads.import"],
  },
  { label: "Rendez-vous", permissions: ["appointments.manage_all", "appointments.manage_own", "dispatch.manage"] },
  { label: "Configuration", permissions: ["statuses.manage", "fields.manage", "settings.manage"] },
  { label: "Équipe", permissions: ["members.manage", "roles.manage"] },
  { label: "Pilotage", permissions: ["dashboard.view", "billing.manage"] },
];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function parsePermissions(values: readonly string[]): Permission[] {
  return values.filter(isPermission);
}

/** Un rôle admin possède toutes les permissions. */
export function resolvePermissions(isAdmin: boolean, perms: readonly string[]): Permission[] {
  return isAdmin ? [...PERMISSIONS] : parsePermissions(perms);
}

export function can(perms: readonly string[], perm: Permission, isAdmin = false): boolean {
  return isAdmin || perms.includes(perm);
}

export function canAny(perms: readonly string[], wanted: readonly Permission[], isAdmin = false): boolean {
  return isAdmin || wanted.some((p) => perms.includes(p));
}

/**
 * Rôle « terrain » : celui qui se déplace chez les clients (commercial). Seuls ces rôles ont une zone d'intervention,
 * des horaires de tournée et reçoivent des rendez-vous à répartir. Ni les administrateurs, ni les prospecteurs
 * (qui créent / importent des leads), ni les confirmateurs (qui gèrent tous les rendez-vous) ne se déplacent.
 */
export function isFieldRole(role: { is_admin: boolean; is_field: boolean; permissions: readonly string[] }): boolean {
  // Drapeau explicite `roles.is_field` (miroir de public.is_field_role) : plus déduit des permissions, donc un commercial
  // à qui l'on accorde leads.create garde sa zone. Un rôle admin n'est jamais terrain.
  return !role.is_admin && role.is_field === true;
}

/** Ancienne règle déduite des permissions : sert uniquement au backfill de la migration (et à pré-cocher la case). */
export function legacyFieldRule(permissions: readonly string[]): boolean {
  return permissions.includes("appointments.manage_own") && !permissions.includes("appointments.manage_all") && !permissions.includes("leads.create");
}
