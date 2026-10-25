import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/app/access-denied";
import { DispatchPanel } from "@/components/dispatch/dispatch-panel";
import { DispatchedPlanning, type DispatchedRow } from "@/components/dispatch/dispatched-planning";
import { OrgSettingsEditor } from "@/components/dispatch/settings-dialogs";
import { UnavailabilityCard, type UnavailRow } from "@/components/dispatch/unavailability-card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { classifyPending, loadContext, truncationWarnings } from "@/lib/dispatch/server";
import { localDay, localMinutes, fmtMin } from "@/lib/dispatch/time";
import { leadName } from "@/lib/leads/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Répartition" };
export const dynamic = "force-dynamic";

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const s = await requireSession();
  if (!sessionCan(s, "dispatch.manage")) return <AccessDenied />;
  // Vue simulation (?vue=simulation) : seule vue où les lignes is_simulation apparaissent ; elles sont masquées partout ailleurs (RLS).
  const simulation = (await searchParams).vue === "simulation";
  const supabase = simulation ? createAdminClient() : await createClient();
  const ctx = await loadContext(supabase, s.org.id, { simulation });
  const [{ toCheck }, { count }] = await Promise.all([
    classifyPending(ctx),
    createAdminClient().from("leads").select("id", { count: "exact", head: true }).eq("org_id", s.org.id).eq("is_simulation", true),
  ]);

  const today = localDay(new Date());
  const { data: raw } = await supabase.from("appointments")
    .select("id, assigned_to, starts_at, ends_at, locked_by_dispatcher, locked_by, issue_message, lead:leads(first_name, last_name, company)")
    .eq("org_id", s.org.id).eq("is_simulation", simulation).eq("dispatch_status", "assigned").or("dispatched_at.not.is.null,issue_message.not.is.null").neq("status", "cancelled")
    .gte("starts_at", new Date(Date.now() - 86_400_000).toISOString()).order("starts_at").limit(100);
  const ids = [...new Set([...(raw ?? []).flatMap((r) => [r.assigned_to, r.locked_by]).filter(Boolean) as string[], ...ctx.reps.map((r) => r.id)])];
  const { data: profs } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const nm = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "—"]));
  const dispatched: DispatchedRow[] = ((raw ?? []) as unknown as { id: string; assigned_to: string; starts_at: string; ends_at: string; locked_by_dispatcher: boolean; locked_by: string | null; issue_message: string | null; lead: { first_name: string; last_name: string; company: string | null } | null }[])
    .filter((r) => localDay(new Date(r.starts_at)) >= today)
    .map((r) => {
      const st = new Date(r.starts_at);
      const en = new Date(r.ends_at);
      return {
        id: r.id, lead_name: r.lead ? leadName(r.lead) : "Lead", rep_id: r.assigned_to, rep_name: nm.get(r.assigned_to) ?? "—", day: localDay(st),
        start: fmtMin(localMinutes(st)), end: fmtMin(localMinutes(en)), durationMin: Math.round((en.getTime() - st.getTime()) / 60000),
        locked: r.locked_by_dispatcher, lockedByName: r.locked_by ? (nm.get(r.locked_by) ?? null) : null, issue: r.issue_message, response: "assigned" as const,
      };
    });
  const reps = ctx.reps.map((r) => ({ id: r.id, name: r.name }));
  const { data: un } = await supabase.from("sales_unavailability").select("id, user_id, day, start_min, end_min, reason").eq("org_id", s.org.id).gte("day", today).order("day").limit(100);
  const unavail: UnavailRow[] = (un ?? []).map((u) => ({ id: u.id, rep_name: nm.get(u.user_id) ?? "—", day: u.day, startMin: u.start_min, endMin: u.end_min, reason: u.reason }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Répartition automatique"
        description="Le moteur propose, vous décidez : les RDV confirmés sont attribués selon la zone, les routes réelles et les horaires."
        actions={
          <>
            <Button asChild size="sm" variant="ghost"><Link href="/agenda"><ArrowLeft className="size-3.5" /> Agenda</Link></Button>
            <OrgSettingsEditor {...ctx.orgSettings} />
          </>
        }
      />
      <DispatchPanel
        pending={ctx.pending.map((p) => ({ id: p.id, lead_name: p.lead_name, address: p.address, status: p.status, wishFrom: p.wishFrom, wishTo: p.wishTo, durationMin: p.durationMin }))}
        repCount={ctx.reps.length}
        canSimulate
        hasSimulation={(count ?? 0) > 0}
        simulationView={simulation}
        truncations={truncationWarnings(ctx.truncated)}
        toCheck={toCheck}
        fixedCount={ctx.fixedPending + ctx.flagged.length}
      />
      <DispatchedPlanning rows={dispatched} reps={reps} />
      <UnavailabilityCard rows={unavail} reps={reps} />
    </div>
  );
}
