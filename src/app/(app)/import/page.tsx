import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { ImportWizard } from "@/components/import/import-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { loadLeadsMeta } from "@/lib/leads/meta";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const s = await requireSession();
  if (!sessionCan(s, "leads.import")) return <AccessDenied />;
  const meta = await loadLeadsMeta(s);
  const supabase = await createClient();
  const { data: roles } = await supabase.from("roles").select("id, name").eq("org_id", s.org.id).order("created_at");
  const initial = meta.statuses.find((x) => x.is_initial)?.name ?? "Statut initial";
  return (
    <div className="space-y-6">
      <PageHeader title="Import" description="Importez vos leads depuis un fichier CSV : mappage, simulation, puis import par lots." />
      <ImportWizard sources={meta.sources.filter((x) => !x.archived)} members={meta.members} roles={roles ?? []} initialStatus={initial} />
    </div>
  );
}
