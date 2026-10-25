import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { orgWebhookSecret, requireSigningSalt } from "./signature";

export async function currentOrgSecret(orgId: string): Promise<{ secret: string; version: number }> {
  const { data } = await createAdminClient().from("organizations").select("webhook_secret_version").eq("id", orgId).single();
  const version = data?.webhook_secret_version ?? 1;
  return { secret: orgWebhookSecret(requireSigningSalt(), orgId, version), version };
}
