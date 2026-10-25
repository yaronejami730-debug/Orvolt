import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { IntegrationsManager, type EndpointView, type EventView } from "@/components/settings/integrations-manager";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Intégrations" };

export default async function IntegrationsPage() {
  const s = await requireSession();
  if (!sessionCan(s, "settings.manage")) return <AccessDenied />;
  const supabase = await createClient();
  const [ep, ev, so] = await Promise.all([
    supabase.from("inbound_endpoints").select("id, name, kind, token, secret_prefix, secret_version, has_meta_secret, default_source_id, mapping, dedupe_window_hours, active").eq("org_id", s.org.id).order("created_at"),
    supabase.from("inbound_events").select("id, endpoint_id, received_at, status, reason, payload").eq("org_id", s.org.id).order("received_at", { ascending: false }).limit(100),
    supabase.from("lead_sources").select("id, name").eq("org_id", s.org.id).eq("archived", false).order("created_at"),
  ]);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return <IntegrationsManager endpoints={(ep.data ?? []) as EndpointView[]} events={(ev.data ?? []) as EventView[]} sources={so.data ?? []} baseUrl={baseUrl} />;
}
