import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/app/access-denied";
import { requireSession, sessionCan } from "@/lib/session";

export default async function SettingsIndex() {
  const s = await requireSession();
  if (sessionCan(s, "statuses.manage")) redirect("/settings/statuses");
  if (sessionCan(s, "fields.manage")) redirect("/settings/fields");
  if (sessionCan(s, "settings.manage")) redirect("/settings/sources");
  if (sessionCan(s, "members.manage")) redirect("/settings/members");
  if (sessionCan(s, "roles.manage")) redirect("/settings/roles");
  return <AccessDenied />;
}
