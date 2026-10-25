import { AppShell } from "@/components/app/app-shell";
import { BillingBanner } from "@/components/billing/billing-banner";
import { getEntitlement } from "@/lib/billing/access";
import { canAny } from "@/lib/permissions";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const ent = await getEntitlement(s.org.id);
  return (
    <AppShell
      orgName={s.org.name}
      orgId={s.org.id}
      orgs={s.orgs.map((o) => ({ id: o.id, name: o.name }))}
      userName={s.profile.full_name ?? s.user.email}
      userEmail={s.user.email}
      roleName={s.role.name}
      banner={<BillingBanner e={ent} canManage={canAny(s.permissions, ["billing.manage"], s.isAdmin)} />}
      showImport={canAny(s.permissions, ["leads.import"], s.isAdmin)}
      showDispatch={canAny(s.permissions, ["dispatch.manage"], s.isAdmin)}
      showSettings={canAny(s.permissions, ["members.manage", "roles.manage", "settings.manage"], s.isAdmin)}
    >
      {children}
    </AppShell>
  );
}
