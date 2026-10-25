import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { FieldsManager, type FieldRow } from "@/components/settings/fields-manager";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Champs personnalisés" };

export default async function FieldsPage() {
  const s = await requireSession();
  if (!sessionCan(s, "fields.manage")) return <AccessDenied />;
  const supabase = await createClient();
  const [f, r] = await Promise.all([
    supabase.from("custom_fields").select("id, key, label, type, options, required, position, visible_roles, editable_roles").eq("org_id", s.org.id).order("position"),
    supabase.from("roles").select("id, name, is_admin").eq("org_id", s.org.id).order("created_at"),
  ]);
  return <FieldsManager fields={(f.data ?? []) as FieldRow[]} roles={r.data ?? []} />;
}
