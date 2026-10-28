import type { Metadata } from "next";
import Link from "next/link";
import { Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccessDenied } from "@/components/app/access-denied";
import { MyTour } from "@/components/agenda/my-tour";
import { AgendaView } from "@/components/agenda/agenda-view";
import { isFieldRole } from "@/lib/permissions";
import { hasFeature } from "@/lib/billing/feature-guard";
import { ZoneEditor } from "@/components/agenda/zone-editor";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Agenda" };
const COLORS = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#6366f1"];

export default async function AgendaPage() {
  const s = await requireSession();
  const all = sessionCan(s, "appointments.manage_all");
  if (!all && !sessionCan(s, "appointments.manage_own")) return <AccessDenied />;
  const zonesOn = await hasFeature(s.org.id, "distance_control");
  const supabase = await createClient();
  const { data: ms } = await supabase.from("memberships").select("user_id").eq("org_id", s.org.id).eq("status", "active");
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", (ms ?? []).map((m) => m.user_id));
  const members = (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" })).filter((m) => all || m.id === s.user.id);
  const colors = Object.fromEntries(members.map((m, i) => [m.id, COLORS[i % COLORS.length]!]));
  const { data: zone } = await supabase.from("sales_zones").select("base_address, radius_km, active").eq("org_id", s.org.id).eq("user_id", s.user.id).maybeSingle();
  return (
    <div className="space-y-6">
      <PageHeader title="Agenda" description="Vos rendez-vous, avec contrôle de la distance à votre zone d'intervention."
        actions={<>{sessionCan(s, "dispatch.manage") && <Button asChild size="sm" variant="outline"><Link href="/agenda/repartition"><Route className="size-3.5" /> Répartition</Link></Button>}{isFieldRole({ is_admin: s.isAdmin, is_field: s.role.is_field, permissions: s.permissions }) && zonesOn && <ZoneEditor userId={s.user.id} name={s.profile.full_name ?? "moi"} label="Ma zone" zone={zone ? { base_address: zone.base_address, radius_km: Number(zone.radius_km), active: zone.active } : null} />}</>} />
      <MyTour orgId={s.org.id} userId={s.user.id} />
      <AgendaView members={members} userId={s.user.id} canAll={all} memberColors={colors} />
    </div>
  );
}
