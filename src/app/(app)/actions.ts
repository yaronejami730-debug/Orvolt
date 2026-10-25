"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { getSession, ORG_COOKIE, ORG_COOKIE_OPTIONS } from "@/lib/session";

export async function switchOrgAction(orgId: string): Promise<{ ok: boolean }> {
  const id = z.uuid().safeParse(orgId);
  const session = await getSession();
  if (!id.success || !session || !session.orgs.some((o) => o.id === id.data)) return { ok: false };
  (await cookies()).set(ORG_COOKIE, id.data, ORG_COOKIE_OPTIONS);
  return { ok: true };
}
