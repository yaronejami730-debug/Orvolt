import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { SourcesManager, type SourceRow } from "@/components/settings/sources-manager";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Sources de leads" };

export default async function SourcesPage() {
  const s = await requireSession();
  if (!sessionCan(s, "settings.manage")) return <AccessDenied />;
  const supabase = await createClient();
  const { data } = await supabase.from("lead_sources").select("id, name, color, is_default, is_system, archived").eq("org_id", s.org.id).order("is_system").order("created_at");
  const { data: lc } = await supabase.rpc("source_lead_counts", { p_org: s.org.id });
  const counts = new Map(((lc ?? []) as { source_id: string; n: number }[]).map((c) => [c.source_id, Number(c.n)]));
  return <SourcesManager sources={((data ?? []) as SourceRow[]).map((x) => ({ ...x, leads: counts.get(x.id) ?? 0 }))} />;
}
