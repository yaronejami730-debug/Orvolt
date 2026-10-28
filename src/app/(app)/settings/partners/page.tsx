import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { PartnersManager, type PartnerRow } from "@/components/settings/partners-manager";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Régies partenaires" };
export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  const s = await requireSession();
  if (!s.isAdmin || s.org.parent_org_id) return <AccessDenied />;
  const admin = createAdminClient();
  const { data: kids } = await admin.from("organizations").select("id, name, created_at").eq("parent_org_id", s.org.id).order("created_at");
  const ids = (kids ?? []).map((k) => k.id as string);
  const { data: mem } = ids.length
    ? await admin.from("memberships").select("org_id, user_id, role:roles!inner(system_key)").in("org_id", ids).eq("status", "active").eq("via_parent", false)
    : { data: [] };
  const userIds = [...new Set((mem ?? []).map((m) => m.user_id as string))];
  const { data: profs } = userIds.length ? await admin.from("profiles").select("id, full_name, email").in("id", userIds) : { data: [] };
  const name = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name ?? p.email ?? "—") as string]));
  const rows: PartnerRow[] = (kids ?? []).map((k) => {
    const members = (mem ?? []).filter((m) => m.org_id === k.id);
    const boss = members.find((m) => (m.role as unknown as { system_key: string | null }).system_key === "super_admin");
    return { id: k.id as string, name: k.name as string, members: members.length, manager: boss ? name.get(boss.user_id as string) ?? "—" : null };
  });
  return <PartnersManager partners={rows} template={s.org.template} />;
}
