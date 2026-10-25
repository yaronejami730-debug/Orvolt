import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { WebhookSecret } from "@/components/settings/webhook-secret";
import { currentOrgSecret } from "@/lib/automation/secret";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const s = await requireSession();
  if (!s.isAdmin || !sessionCan(s, "settings.manage")) return <AccessDenied />;
  try {
    const { secret, version } = await currentOrgSecret(s.org.id);
    return <WebhookSecret secret={secret} version={version} />;
  } catch {
    return <p role="alert" className="text-sm text-destructive">Le sel de signature (WEBHOOK_SIGNING_SALT) n&apos;est pas configuré sur le serveur.</p>;
  }
}
