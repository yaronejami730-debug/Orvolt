import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/app/access-denied";
import { LeadDetail, type DetailData } from "@/components/leads/lead-detail";
import { loadLeadsMeta } from "@/lib/leads/meta";
import { LEAD_COLS, leadName, type LeadRow } from "@/lib/leads/types";
import { loadDomains } from "@/lib/call-programming-server";
import type { QuestionType } from "@/lib/call-scripts";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";
import { z } from "zod";

export const metadata: Metadata = { title: "Fiche lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (!sessionCan(s, "leads.view_all") && !sessionCan(s, "leads.view_own")) return <AccessDenied />;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads_api").select(LEAD_COLS).eq("id", id).eq("org_id", s.org.id).maybeSingle();
  if (!lead) notFound(); // introuvable ou hors périmètre (RLS) : même réponse
  // Formulaires d'appel applicables à ce membre pour ce lead (fonction SQL : le serveur ne se fie pas au client), du plus pertinent au moins pertinent.
  const { data: applicable } = await supabase.rpc("call_scripts_for_member", { p_lead: id });
  const order = ((applicable ?? []) as { script_id: string; is_default: boolean; reason: string }[]);
  const ids = order.map((r) => r.script_id);
  const [meta, ev, notes, calls, appts, files, scRows, qRows, runRows, domains] = await Promise.all([
    loadLeadsMeta(s),
    supabase.from("lead_events").select("id, type, payload, actor_id, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("lead_notes").select("id, author_id, body, created_at").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("lead_calls").select("id, caller_id, outcome, duration_seconds, notes, called_at").eq("lead_id", id).order("called_at", { ascending: false }),
    supabase.from("appointments").select("id, lead_id, assigned_to, starts_at, ends_at, status, location_address, distance_km, distance_status, distance_override, override_reason, notes").eq("lead_id", id).not("starts_at", "is", null).order("starts_at"),
    supabase.from("lead_files").select("id, name, size_bytes, mime_type, created_at").eq("lead_id", id).order("created_at", { ascending: false }),
    ids.length ? supabase.from("call_scripts").select("id, name, description, domain_id").in("id", ids) : Promise.resolve({ data: [] as { id: string; name: string; description: string | null; domain_id: string | null }[] }),
    ids.length ? supabase.from("call_script_questions").select("id, script_id, label, help, type, choices, required, show_if").in("script_id", ids).order("position") : Promise.resolve({ data: [] as { id: string; script_id: string; label: string; help: string | null; type: string; choices: unknown; required: boolean; show_if: unknown }[] }),
    supabase.from("call_script_runs").select("id, script_name, domain_name, user_id, answers, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
    loadDomains(supabase, s.org.id),
  ]);
  const scripts: DetailData["scripts"] = order.flatMap((o) => {
    const sc = (scRows.data ?? []).find((x) => x.id === o.script_id);
    if (!sc) return [];
    return [{
      id: sc.id, name: sc.name, description: sc.description, domainId: sc.domain_id, isDefault: o.is_default, reason: o.reason,
      questions: (qRows.data ?? []).filter((q) => q.script_id === sc.id).map((q) => ({
        id: q.id, label: q.label, help: q.help, type: q.type as QuestionType, choices: (q.choices ?? []) as string[], required: q.required,
        showIf: q.show_if ? { question: (q.show_if as { question: string }).question, equals: (q.show_if as { equals: string }).equals } : null,
      })),
    }];
  });
  const data: DetailData = {
    lead: lead as unknown as LeadRow,
    events: ev.data ?? [],
    notes: notes.data ?? [],
    calls: calls.data ?? [],
    files: files.data ?? [],
    scripts,
    runs: (runRows.data ?? []) as DetailData["runs"],
    domains,
    appts: (appts.data ?? []).map((a) => ({ ...a, distance_km: a.distance_km === null ? null : Number(a.distance_km), lead_name: leadName(lead as unknown as LeadRow) })) as unknown as DetailData["appts"],
  };
  return <LeadDetail meta={meta} data={data} />;
}
