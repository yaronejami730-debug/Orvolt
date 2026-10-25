import type { Metadata } from "next";
import { LeadsView } from "@/components/leads/leads-view";
import { PageHeader } from "@/components/ui/page-header";
import { AccessDenied } from "@/components/app/access-denied";
import { after } from "next/server";
import { runMissedActions } from "@/lib/automation/catchup";
import { loadLeadsMeta } from "@/lib/leads/meta";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  const s = await requireSession();
  if (!sessionCan(s, "leads.view_all") && !sessionCan(s, "leads.view_own")) return <AccessDenied />;
  const meta = await loadLeadsMeta(s);
  // Rattrapage discret des actions auto manquées (changements de statut hors RPC).
  after(() => runMissedActions(s.org.id, s.org.slug).catch((e) => console.error("[automation:catchup]", e instanceof Error ? e.message : e)));
  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="Suivez vos leads du premier contact à la signature." />
      <LeadsView meta={meta} />
    </div>
  );
}
