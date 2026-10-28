import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { AddMemberDialog } from "@/components/settings/add-member-dialog";
import { isFieldRole } from "@/lib/permissions";
import Link from "next/link";
import { hasFeature } from "@/lib/billing/feature-guard";
import { getEntitlement } from "@/lib/billing/access";
import { entitlementAllowsRole } from "@/lib/billing/features";
import { minPlanFor } from "@/lib/billing/plans";
import { ZoneEditor } from "@/components/agenda/zone-editor";
import { OrgSettingsEditor, WorkSettingsEditor } from "@/components/dispatch/settings-dialogs";
import { MemberRoleSelect, MemberStatusButton } from "@/components/settings/member-controls";
import { MemberCallProgramming } from "@/components/settings/member-call-programming";
import { resolveScriptsForMember } from "@/lib/call-programming";
import { loadDomains, loadProgramming } from "@/lib/call-programming-server";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_ORG } from "@/lib/dispatch/settings";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Membres" };

export default async function MembersPage() {
  const s = await requireSession();
  const zonesOn = await hasFeature(s.org.id, "distance_control");
  if (!sessionCan(s, "members.manage")) return <AccessDenied />;
  const supabase = await createClient();
  const [{ data: members }, { data: roles }] = await Promise.all([
    supabase.from("memberships").select("id, user_id, role_id, status").eq("org_id", s.org.id).eq("via_parent", false).order("created_at"),
    supabase.from("roles").select("id, name, is_admin, is_system, system_key, is_field, permissions").eq("org_id", s.org.id).order("created_at"),
  ]);
  const { data: zones } = await supabase.from("sales_zones").select("user_id, base_address, radius_km, active, work_start, work_end, target_per_day, comfort_max, absolute_max, work_days, default_duration_min, travel_min_per_km, travel_margin_min").eq("org_id", s.org.id);
  const fieldRoleIds = new Set((roles ?? []).filter((r) => isFieldRole({ is_admin: r.is_admin, is_field: r.is_field, permissions: r.permissions ?? [] })).map((r) => r.id));
  const zoneBy = new Map((zones ?? []).map((z) => [z.user_id, z]));
  const { data: ds } = await supabase.from("dispatch_settings").select("max_leg_km, horizon_days, max_leg_min, max_base_min, traffic_morning_coef, traffic_evening_coef, safety_margin_pct, target_per_day, comfort_max, absolute_max, max_extra_minutes").eq("org_id", s.org.id).maybeSingle();
  const canOrgDispatch = sessionCan(s, "dispatch.manage") || sessionCan(s, "settings.manage");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const activeCount = (members ?? []).filter((m) => m.status === "active").length;
  const roleList = (roles ?? []).filter((r) => s.isAdmin || !r.is_admin);
  // Rôles non inclus dans le plan (nouvelles attributions bloquées, voir roleAllowedForPlan) : affichés en grisé avec « Pro ».
  const ent = await getEntitlement(s.org.id);
  const lockedRoleIds = (roles ?? []).filter((r) => !entitlementAllowsRole(ent, r)).map((r) => r.id);
  const lockPlan = minPlanFor("specialized_roles").name;
  // Programmation des formulaires d'appel (Pro+) : domaines, affectations et aperçu « aujourd'hui » de chaque membre.
  const progOn = await hasFeature(s.org.id, "call_script_programming");
  const prog = progOn ? await loadProgramming(supabase, s.org.id) : null;
  const callDomains = progOn ? await loadDomains(supabase, s.org.id) : [];
  const progCtx = { scripts: prog?.scripts ?? [], domains: callDomains, members: (members ?? []).map((m) => ({ id: m.user_id, name: byId.get(m.user_id)?.full_name ?? byId.get(m.user_id)?.email ?? "—" })) };
  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="seat-count">
          {activeCount} / {s.org.seat_limit ?? "∞"} sièges utilisés
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canOrgDispatch && <OrgSettingsEditor maxLegKm={Number(ds?.max_leg_km ?? 40)} horizonDays={ds?.horizon_days ?? 7} maxLegMin={ds?.max_leg_min ?? 45} maxBaseMin={ds?.max_base_min ?? 75} morningCoef={Number(ds?.traffic_morning_coef ?? 1.25)} eveningCoef={Number(ds?.traffic_evening_coef ?? 1.4)} safetyPct={ds?.safety_margin_pct ?? 10} targetPerDay={ds?.target_per_day ?? DEFAULT_ORG.targetPerDay} comfortMax={ds?.comfort_max ?? DEFAULT_ORG.comfortMax} absoluteMax={ds?.absolute_max ?? DEFAULT_ORG.absoluteMax} maxExtraMin={ds?.max_extra_minutes ?? 20} />}
          <AddMemberDialog roles={roleList} lockedRoleIds={lockedRoleIds} lockPlan={lockPlan} domains={callDomains} />
        </div>
      </div>
      <div>
        <Table className="max-md:block">
          <TableHeader className="max-md:hidden">
            <TableRow>
              <TableHead>Membre</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block">
            {(members ?? []).map((m) => {
              const p = byId.get(m.user_id);
              const self = m.user_id === s.user.id;
              return (
                <TableRow key={m.id} className="max-md:grid max-md:grid-cols-[1fr_auto] max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:p-3">
                  <TableCell className="max-md:col-span-2 max-md:block max-md:p-0">
                    <div className="flex items-center gap-3">
                      <Avatar name={p?.full_name ?? p?.email ?? "?"} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p?.full_name ?? "—"}{self && " (vous)"}</p>
                        <p className="truncate text-xs text-muted-foreground">{p?.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-md:p-0">
                    <MemberRoleSelect membershipId={m.id} roleId={m.role_id} roles={roles ?? []} lockedRoleIds={lockedRoleIds} lockPlan={lockPlan} disabled={self} />
                  </TableCell>
                  <TableCell className="max-md:col-span-2 max-md:p-0">
                    {(() => {
                      const z = zoneBy.get(m.user_id);
                      // Les zones ne concernent que les commerciaux (ceux qui se déplacent).
                      if (!fieldRoleIds.has(m.role_id)) return <span className="text-xs text-muted-foreground" data-testid={`zone-${p?.email}`}>Sans déplacement</span>;
                      return (
                        <span className="flex flex-wrap items-center gap-2 text-xs" data-testid={`zone-${p?.email}`}>
                          <span className="text-muted-foreground">{z && z.active ? `${Number(z.radius_km)} km` : "Non définie"}</span>
                          {zonesOn ? <ZoneEditor userId={m.user_id} name={p?.full_name ?? p?.email ?? "membre"} zone={z ? { base_address: z.base_address, radius_km: Number(z.radius_km), active: z.active } : null} /> : <Link href="/settings/billing" className="text-link underline-offset-2 hover:underline" data-testid="zone-locked">Disponible avec le plan {minPlanFor("distance_control").name}</Link>}
                          <WorkSettingsEditor userId={m.user_id} name={p?.full_name ?? p?.email ?? "membre"} hasZone={!!z}
                            work={{ workStart: String(z?.work_start ?? "09:00").slice(0, 5), workEnd: String(z?.work_end ?? "19:00").slice(0, 5), targetPerDay: z?.target_per_day ?? null, comfortMax: z?.comfort_max ?? null, absoluteMax: z?.absolute_max ?? null, workDays: (z?.work_days as number[] | undefined) ?? [1, 2, 3, 4, 5], durationMin: z?.default_duration_min ?? 60, travelMinPerKm: Number(z?.travel_min_per_km ?? 1.2), travelMarginMin: z?.travel_margin_min ?? 10 }} />
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="max-md:order-last max-md:p-0">
                    <Badge tone={m.status === "active" ? "success" : "neutral"} dot>{m.status === "active" ? "Actif" : "Désactivé"}</Badge>
                  </TableCell>
                  <TableCell className="text-right max-md:p-0">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                    {prog && (() => {
                      const mine = prog.memberDomains.get(m.user_id) ?? [];
                      const res = resolveScriptsForMember({ member: { userId: m.user_id, domainIds: mine }, domains: callDomains, assignments: prog.assignments, scripts: prog.scripts, now: new Date(nowIso) });
                      return <MemberCallProgramming userId={m.user_id} name={p?.full_name ?? p?.email ?? "membre"} ctx={progCtx} memberDomainIds={mine} assignments={prog.assignments.filter((a) => a.scope === "member" && a.userId === m.user_id)} preview={res.scripts.map((x) => ({ name: x.name, isDefault: x.isDefault }))} now={nowIso} />;
                    })()}
                    <MemberStatusButton membershipId={m.id} active={m.status === "active"} disabled={self} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
