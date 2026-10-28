import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Assignment, CallDomain, ScriptLite } from "@/lib/call-programming";

type SB = Awaited<ReturnType<typeof createClient>>;

export interface AssignmentRow {
  id: string; script_id: string; scope: "member" | "domain" | "all"; user_id: string | null; domain_id: string | null;
  starts_on: string | null; ends_on: string | null; days: number[] | null; time_from: string | null; time_to: string | null; active: boolean; priority: number;
}
export const ASSIGNMENT_COLS = "id, script_id, scope, user_id, domain_id, starts_on, ends_on, days, time_from, time_to, active, priority";
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

export const toAssignment = (r: AssignmentRow): Assignment => ({
  id: r.id, scriptId: r.script_id, scope: r.scope, userId: r.user_id, domainId: r.domain_id, startsOn: r.starts_on, endsOn: r.ends_on,
  days: r.days && r.days.length ? r.days.map(Number) : null, timeFrom: hm(r.time_from), timeTo: hm(r.time_to), active: r.active, priority: r.priority,
});

/** Domaines de l'organisation (lecture ouverte aux membres : liste de saisie du lead). */
export async function loadDomains(supabase: SB, orgId: string): Promise<CallDomain[]> {
  const { data } = await supabase.from("call_domains").select("id, name, color, active, position").eq("org_id", orgId).order("position").order("name");
  return (data ?? []) as CallDomain[];
}

/** Formulaires (sans questions) et affectations : réservé aux gérants (RLS). */
export async function loadProgramming(supabase: SB, orgId: string) {
  const [sc, as, md] = await Promise.all([
    supabase.from("call_scripts").select("id, name, active, domain_id, position").eq("org_id", orgId).order("position"),
    supabase.from("call_script_assignments").select(ASSIGNMENT_COLS).eq("org_id", orgId).order("created_at"),
    supabase.from("member_call_domains").select("user_id, domain_id").eq("org_id", orgId),
  ]);
  const scripts: ScriptLite[] = (sc.data ?? []).map((s) => ({ id: s.id, name: s.name, active: s.active, domainId: s.domain_id, position: s.position }));
  const assignments = ((as.data ?? []) as AssignmentRow[]).map(toAssignment);
  const memberDomains = new Map<string, string[]>();
  for (const m of md.data ?? []) memberDomains.set(m.user_id, [...(memberDomains.get(m.user_id) ?? []), m.domain_id]);
  return { scripts, assignments, memberDomains };
}
