import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { ApplyTemplateButton } from "@/components/settings/apply-template";
import { StatusGrantsMatrix, type GrantRow } from "@/components/settings/status-grants-matrix";
import { StatusesManager } from "@/components/settings/statuses-manager";
import type { ActionRow, StatusRow, TransitionRow } from "@/components/settings/workflow-types";
import { FeatureLocked } from "@/components/billing/feature-locked";
import { hasFeature } from "@/lib/billing/feature-guard";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Statuts" };

export default async function StatusesPage() {
  const s = await requireSession();
  if (!sessionCan(s, "statuses.manage")) return <AccessDenied />;
  if (!(await hasFeature(s.org.id, "status_tracking"))) return <FeatureLocked feature="status_tracking" canUpgrade={sessionCan(s, "billing.manage") && !s.org.parent_org_id} />;
  const supabase = await createClient();
  const org = s.org.id;
  const [st, tr, ac, ro, me, gr] = await Promise.all([
    supabase.from("statuses").select("id, name, color, position, kind, is_initial").eq("org_id", org).order("position"),
    supabase.from("status_transitions").select("from_status_id, to_status_id, role_id").eq("org_id", org),
    supabase.from("status_actions").select("id, status_id, type, config, position, enabled").eq("org_id", org),
    supabase.from("roles").select("id, name, is_admin, system_key").eq("org_id", org).order("created_at"),
    supabase.from("memberships").select("user_id").eq("org_id", org).eq("status", "active"),
    supabase.from("status_role_grants").select("status_id, role_id, can_place, can_create").eq("org_id", org),
  ]);
  const { data: lc } = await supabase.rpc("status_lead_counts", { p_org: org });
  const leadCounts = Object.fromEntries(((lc ?? []) as { status_id: string; n: number }[]).map((c) => [c.status_id, Number(c.n)]));
  const uids = (me.data ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", uids);
  return (
    <div className="space-y-6">
    <StatusesManager
      statuses={(st.data ?? []) as StatusRow[]}
      transitions={(tr.data ?? []) as TransitionRow[]}
      actions={(ac.data ?? []) as ActionRow[]}
      roles={ro.data ?? []}
      members={(profiles ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "—" }))}
      canManage
      leadCounts={leadCounts}
      emptyAction={<ApplyTemplateButton current={s.org.template} />}
    />
    <StatusGrantsMatrix
      statuses={(st.data ?? []) as StatusRow[]}
      roles={ro.data ?? []}
      grants={(gr.data ?? []) as GrantRow[]}
      isSuperAdmin={s.isAdmin}
      myRoleId={s.role.id}
    />
    </div>
  );
}
