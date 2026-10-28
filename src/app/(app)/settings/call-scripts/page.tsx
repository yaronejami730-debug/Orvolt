import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { FeatureLocked } from "@/components/billing/feature-locked";
import { CallScriptsManager, DomainsManager, type ScriptRow } from "@/components/settings/call-scripts-manager";
import { hasFeature } from "@/lib/billing/feature-guard";
import { loadDomains, loadProgramming } from "@/lib/call-programming-server";
import type { QuestionType } from "@/lib/call-scripts";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Formulaires d'appel" };

export default async function CallScriptsPage() {
  const s = await requireSession();
  const canBuild = sessionCan(s, "fields.manage");
  const canProgram = sessionCan(s, "members.manage") || sessionCan(s, "settings.manage");
  if (!canBuild && !canProgram) return <AccessDenied />;
  const supabase = await createClient();
  const programmingOn = await hasFeature(s.org.id, "call_script_programming");
  const [domains, prog, { data: scripts }, { data: qs }, { data: members }] = await Promise.all([
    loadDomains(supabase, s.org.id),
    canProgram ? loadProgramming(supabase, s.org.id) : Promise.resolve({ assignments: [] }),
    supabase.from("call_scripts").select("id, name, description, active, domain_id").eq("org_id", s.org.id).order("position"),
    supabase.from("call_script_questions").select("id, script_id, label, help, type, choices, required, show_if").eq("org_id", s.org.id).order("position"),
    supabase.from("memberships").select("user_id").eq("org_id", s.org.id).eq("status", "active"),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", (members ?? []).map((m) => m.user_id));
  const rows: ScriptRow[] = (scripts ?? []).map((sc) => ({
    id: sc.id, name: sc.name, description: sc.description, active: sc.active, domainId: sc.domain_id,
    questions: (qs ?? []).filter((q) => q.script_id === sc.id).map((q) => ({
      id: q.id, label: q.label, help: q.help, type: q.type as QuestionType, choices: (q.choices ?? []) as string[], required: q.required,
      showIf: q.show_if ? { question: (q.show_if as { question: string }).question, equals: (q.show_if as { equals: string }).equals } : null,
    })),
  }));
  const ctx = {
    scripts: rows.map((r, i) => ({ id: r.id, name: r.name, active: r.active, domainId: r.domainId, position: i })),
    domains,
    members: (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" })),
  };
  return (
    <div className="space-y-8">
      <CallScriptsManager scripts={rows} assignments={"assignments" in prog ? prog.assignments : []} ctx={ctx} canBuild={canBuild} canProgram={canProgram} programmingOn={programmingOn} now={new Date().toISOString()} />
      {programmingOn ? (canProgram && <DomainsManager domains={domains} />) : <FeatureLocked feature="call_script_programming" canUpgrade={sessionCan(s, "billing.manage")} />}
    </div>
  );
}
