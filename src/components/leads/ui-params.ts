import { z } from "zod";
import { listParamsSchema, type ListParams } from "@/lib/validation/leads";

export type LeadsView = "kanban" | "table";

export const DEFAULT_PARAMS: ListParams = listParamsSchema.parse({});

/** Sérialise les filtres dans l'URL (court : uniquement ce qui diffère des valeurs par défaut). */
export function paramsToSearch(p: ListParams, view: LeadsView): string {
  const u = new URLSearchParams();
  u.set("view", view);
  if (p.statuses.length) u.set("statuses", p.statuses.join(","));
  if (p.sources.length) u.set("sources", p.sources.join(","));
  if (p.assigned.length) u.set("assigned", p.assigned.join(","));
  if (p.from) u.set("from", p.from);
  if (p.to) u.set("to", p.to);
  if (p.q) u.set("q", p.q);
  for (const [k, v] of Object.entries(p.custom)) u.set(`cf_${k}`, v);
  if (p.sort !== DEFAULT_PARAMS.sort) u.set("sort", p.sort);
  if (p.dir !== DEFAULT_PARAMS.dir) u.set("dir", p.dir);
  if (p.page > 1) u.set("page", String(p.page));
  if (p.pageSize !== 25) u.set("size", String(p.pageSize));
  return u.toString();
}

export function searchToParams(search: string): { params: ListParams; view: LeadsView | null } {
  const u = new URLSearchParams(search);
  const list = (k: string) => (u.get(k) ? u.get(k)!.split(",").filter(Boolean) : []);
  const custom: Record<string, string> = {};
  u.forEach((v, k) => {
    if (k.startsWith("cf_")) custom[k.slice(3)] = v;
  });
  const parsed = listParamsSchema.safeParse({
    statuses: list("statuses"), sources: list("sources"), assigned: list("assigned"),
    from: u.get("from") || undefined, to: u.get("to") || undefined, q: u.get("q") || undefined, custom,
    sort: u.get("sort") || undefined, dir: u.get("dir") || undefined,
    page: u.get("page") ? Number(u.get("page")) : undefined, pageSize: u.get("size") ? Number(u.get("size")) : undefined,
  });
  const v = u.get("view");
  return { params: parsed.success ? parsed.data : DEFAULT_PARAMS, view: v === "kanban" || v === "table" ? v : null };
}

export const hasFilters = (p: ListParams) =>
  !!(p.statuses.length || p.sources.length || p.assigned.length || p.from || p.to || p.q || Object.keys(p.custom).length);

export type { z };
