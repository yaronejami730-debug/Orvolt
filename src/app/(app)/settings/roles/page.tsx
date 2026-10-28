import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { DeleteRoleButton, RoleEditor, type RoleView } from "@/components/settings/role-editor";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FeatureLocked } from "@/components/billing/feature-locked";
import { hasFeature } from "@/lib/billing/feature-guard";
import { parsePermissions, resolvePermissions } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Rôles" };

export default async function RolesPage() {
  const s = await requireSession();
  if (!sessionCan(s, "roles.manage")) return <AccessDenied />;
  if (!(await hasFeature(s.org.id, "custom_roles"))) return <FeatureLocked feature="custom_roles" canUpgrade={sessionCan(s, "billing.manage") && !s.org.parent_org_id} />;
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("id, name, description, is_system, is_admin, is_field, system_key, permissions")
    .eq("org_id", s.org.id)
    .order("created_at");
  const roles: RoleView[] = (data ?? []).map((r) => ({
    ...r,
    permissions: r.is_admin ? resolvePermissions(true, []) : parsePermissions(r.permissions),
  }));

  // Anti-escalade (aussi appliquée en base) : on n'accorde que ce que l'on possède ; son propre rôle ne gagne rien.
  const grantable = (r: RoleView) => (s.isAdmin ? undefined : r.id === s.role.id ? r.permissions : s.permissions);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RoleEditor /></div>
      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.id} className="space-y-3 p-5" data-testid={`role-${r.name}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold">{r.name}{r.id === s.role.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(votre rôle)</span>}</h3>
                <p className="text-sm text-muted-foreground">{r.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {r.is_admin ? (
                  <Badge tone="accent" data-testid="badge-super-admin"><Lock className="mr-1 size-3" aria-hidden />Verrouillé</Badge>
                ) : r.is_system && <Badge tone="accent">Système</Badge>}
                {!r.is_admin && (s.isAdmin || r.system_key !== "administrator") && <RoleEditor role={r} allowed={grantable(r)} />}
                {!r.is_system && <DeleteRoleButton role={r} />}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.is_admin ? "Toutes les permissions" : `${r.permissions.length} permission${r.permissions.length > 1 ? "s" : ""}`}
            </p>
            {(r.is_admin || (r.system_key === "administrator" && !s.isAdmin)) && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`readonly-${r.name}`}>
                <Lock className="size-3" aria-hidden />
                {r.is_admin ? "Pouvoir total, non modifiable." : "Lecture seule : réservé au super administrateur."}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
