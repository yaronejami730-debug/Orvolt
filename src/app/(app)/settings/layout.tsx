import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession, sessionCan } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const items = [
    ...(sessionCan(s, "statuses.manage") ? [{ href: "/settings/statuses", label: "Statuts" }] : []),
    ...(sessionCan(s, "fields.manage") ? [{ href: "/settings/fields", label: "Champs" }] : []),
    ...(sessionCan(s, "settings.manage") ? [{ href: "/settings/sources", label: "Sources" }] : []),
    ...(sessionCan(s, "billing.manage") ? [{ href: "/settings/billing", label: "Facturation" }] : []),
    ...(sessionCan(s, "settings.manage") ? [{ href: "/settings/integrations", label: "Intégrations" }] : []),
    ...(s.isAdmin && sessionCan(s, "settings.manage") ? [{ href: "/settings/webhooks", label: "Webhooks" }] : []),
    ...(sessionCan(s, "members.manage") ? [{ href: "/settings/members", label: "Membres" }] : []),
    ...(sessionCan(s, "roles.manage") ? [{ href: "/settings/roles", label: "Rôles & permissions" }] : []),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Paramètres" description="Équipe, rôles et configuration de votre organisation." />
      {items.length > 0 && <SettingsNav items={items} />}
      {children}
    </div>
  );
}
