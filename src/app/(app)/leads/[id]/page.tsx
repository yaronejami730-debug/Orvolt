import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/app/access-denied";
import { LeadDetail, type DetailData } from "@/components/leads/lead-detail";
import { loadLeadsMeta } from "@/lib/leads/meta";
import { LEAD_COLS, leadName, type LeadRow } from "@/lib/leads/types";
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
  const [meta, ev, notes, calls, appts, files] = await Promise.all([
    loadLeadsMeta(s),
    supabase.from("lead_events").select("id, type, payload, actor_id, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("lead_notes").select("id, author_id, body, created_at").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("lead_calls").select("id, caller_id, outcome, duration_seconds, notes, called_at").eq("lead_id", id).order("called_at", { ascending: false }),
    supabase.from("appointments").select("id, lead_id, assigned_to, starts_at, ends_at, status, location_address, distance_km, distance_status, distance_override, override_reason, notes").eq("lead_id", id).not("starts_at", "is", null).order("starts_at"),
    supabase.from("lead_files").select("id, name, size_bytes, mime_type, created_at").eq("lead_id", id).order("created_at", { ascending: false }),
  ]);
  const data: DetailData = {
    lead: lead as unknown as LeadRow,
    events: ev.data ?? [],
    notes: notes.data ?? [],
    calls: calls.data ?? [],
    files: files.data ?? [],
    appts: (appts.data ?? []).map((a) => ({ ...a, distance_km: a.distance_km === null ? null : Number(a.distance_km), lead_name: leadName(lead as unknown as LeadRow) })) as unknown as DetailData["appts"],
  };
  return <LeadDetail meta={meta} data={data} />;
}
