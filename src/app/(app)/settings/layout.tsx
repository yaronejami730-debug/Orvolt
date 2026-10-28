import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeader } from "@/components/ui/page-header";
import { hasFeature } from "@/lib/billing/feature-guard";
import { requireSession, sessionCan } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const prioritySupport = await hasFeature(s.org.id, "priority_support");
  const items = [
    ...(sessionCan(s, "statuses.manage") ? [{ href: "/settings/statuses", label: "Statuts" }] : []),
    ...(sessionCan(s, "fields.manage") ? [{ href: "/settings/fields", label: "Champs" }] : []),
    ...(sessionCan(s, "fields.manage") || sessionCan(s, "settings.manage") || sessionCan(s, "members.manage") ? [{ href: "/settings/call-scripts", label: "Formulaires d'appel" }] : []),
    ...(sessionCan(s, "settings.manage") ? [{ href: "/settings/sources", label: "Sources" }] : []),
    ...(sessionCan(s, "billing.manage") && !s.org.parent_org_id ? [{ href: "/settings/billing", label: "Facturation" }] : []),
    ...(s.isAdmin && !s.org.parent_org_id ? [{ href: "/settings/partners", label: "Régies partenaires" }] : []),
    ...(sessionCan(s, "settings.manage") ? [{ href: "/settings/integrations", label: "Intégrations" }] : []),
    ...(s.isAdmin && sessionCan(s, "settings.manage") ? [{ href: "/settings/webhooks", label: "Webhooks" }] : []),
    ...(sessionCan(s, "members.manage") ? [{ href: "/settings/members", label: "Membres" }] : []),
    ...(sessionCan(s, "roles.manage") ? [{ href: "/settings/roles", label: "Rôles & permissions" }] : []),
    ...(prioritySupport ? [{ href: "/contact", label: "Support prioritaire" }] : []),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Paramètres" description="Équipe, rôles et configuration de votre organisation." />
      {items.length > 0 && <SettingsNav items={items} />}
      {children}
    </div>
  );
}
