import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CheckSquare, Users } from "lucide-react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEntitlement } from "@/lib/billing/access";
import { hasFeature } from "@/lib/billing/feature-guard";
import { FeatureLocked } from "@/components/billing/feature-locked";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const s = await requireSession();
  const greeting = `Bienvenue ${s.profile.full_name ?? ""} — ${s.org.name}`;
  // Droits et données du tableau de bord lus en parallèle (un seul aller-retour) ; la redirection éventuelle est décidée après.
  const all = sessionCan(s, "leads.view_all");
  const supabase = await createClient();
  const [ent, so, ms] = await Promise.all([
    getEntitlement(s.org.id),
    supabase.from("lead_sources").select("id, name").eq("org_id", s.org.id).order("created_at"),
    all ? supabase.from("memberships").select("user_id").eq("org_id", s.org.id).eq("status", "active") : Promise.resolve({ data: [] as { user_id: string }[] }),
  ]);
  // Organisation en lecture seule : redirection douce de l'accueil vers la facturation (les autres écrans restent consultables).
  if (sessionCan(s, "billing.manage") && !ent.writable) redirect("/settings/billing");
  const analytics = await hasFeature(s.org.id, "analytics");
  if (!sessionCan(s, "dashboard.view") || !analytics) {
    // Pas de statistiques pour ce rôle ou ce plan : accès rapide aux écrans de travail.
    const links = [
      { href: "/leads", label: "Mes leads", icon: Users },
      ...(sessionCan(s, "appointments.manage_own") || sessionCan(s, "appointments.manage_all") ? [{ href: "/agenda", label: "Mon agenda", icon: CalendarDays }] : []),
      { href: "/tasks", label: "Mes tâches", icon: CheckSquare },
    ];
    return (
      <div className="space-y-8">
        <PageHeader title="Dashboard" description={greeting} />
        <div className="grid gap-4 sm:grid-cols-3">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}><Card className="flex items-center gap-3 p-5 transition-colors hover:border-muted-foreground/40"><Icon className="size-5 text-link" aria-hidden /><span className="font-medium">{label}</span></Card></Link>
          ))}
        </div>
        {sessionCan(s, "dashboard.view") && <FeatureLocked feature="analytics" canUpgrade={sessionCan(s, "billing.manage") && !s.org.parent_org_id} />}
      </div>
    );
  }
  const { data: profiles } = all ? await supabase.from("profiles").select("id, full_name, email").in("id", (ms.data ?? []).map((m) => m.user_id)) : { data: [] };
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={greeting} />
      <DashboardView sources={so.data ?? []} members={(profiles ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" }))} canAll={all} />
    </div>
  );
}
