"use client";

import { useCallback, useEffect, useState } from "react";
import { Filter, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canViewField } from "@/lib/custom-fields";
import type { LeadsMeta } from "@/lib/leads/types";
import type { ListParams } from "@/lib/validation/leads";
import { cn } from "@/lib/utils";
import { KanbanBoard } from "./kanban-board";
import { LeadFormDialog } from "./lead-form";
import { LeadsTable } from "./leads-table";
import { DEFAULT_PARAMS, hasFilters, paramsToSearch, searchToParams, type LeadsView as View } from "./ui-params";

const VIEW_KEY = "lf_leads_view";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:border-muted-foreground/60", active && "border-accent bg-accent-soft text-link")}>
      {children}
    </button>
  );
}

export function LeadsView({ meta }: { meta: LeadsMeta }) {
  const [params, setParamsState] = useState<ListParams>(DEFAULT_PARAMS);
  const [view, setView] = useState<View>("kanban");
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState<{ statusId?: string } | null>(null);

  // Lecture de l'URL puis de la préférence enregistrée (après hydratation).
  useEffect(() => {
    const { params: p, view: v } = searchToParams(window.location.search);
    let stored: View | null = null;
    try { const s = localStorage.getItem(VIEW_KEY); stored = s === "table" || s === "kanban" ? s : null; } catch { /* facultatif */ }
    setParamsState(p);
    setSearch(p.q ?? "");
    setView(v ?? stored ?? "kanban");
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    window.history.replaceState(null, "", `/leads?${paramsToSearch(params, view)}`);
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* facultatif */ }
  }, [params, view, ready]);
  // Recherche avec délai.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setParamsState((p) => ((p.q ?? "") === search.trim() ? p : { ...p, q: search.trim() || undefined, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search, ready]);

  const setParams = useCallback((p: ListParams) => setParamsState(p), []);
  const toggle = (key: "statuses" | "sources" | "assigned", id: string) =>
    setParams({ ...params, [key]: params[key].includes(id) ? params[key].filter((x) => x !== id) : [...params[key], id], page: 1 });
  const ctx = { roleId: meta.roleId, isAdmin: meta.isAdmin };
  const filterable = meta.fields.filter((f) => canViewField(f, ctx) && ["text", "select", "number", "address"].includes(f.type));
  const active = hasFilters(params);
  const clear = () => { setSearch(""); setParams({ ...params, statuses: [], sources: [], assigned: [], from: undefined, to: undefined, q: undefined, custom: {}, page: 1 }); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Rechercher un lead" placeholder="Nom, téléphone, e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant={showFilters || active ? "secondary" : "outline"} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <Filter className="size-4" /> Filtres {active && <Badge tone="accent">!</Badge>}
        </Button>
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="ml-auto">
          <TabsList>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="table">Tableau</TabsTrigger>
          </TabsList>
        </Tabs>
        {meta.can.create && <Button className="max-sm:hidden" onClick={() => setCreating({})}><Plus className="size-4" /> Nouveau lead</Button>}
      </div>

      {showFilters && (
        <div className="space-y-4 rounded-lg border bg-card p-4" role="region" aria-label="Filtres">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Statut</p>
            <div className="flex flex-wrap gap-2">{meta.statuses.map((s) => <Chip key={s.id} active={params.statuses.includes(s.id)} onClick={() => toggle("statuses", s.id)}>{s.name}</Chip>)}</div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</p>
            <div className="flex flex-wrap gap-2">{meta.sources.map((s) => <Chip key={s.id} active={params.sources.includes(s.id)} onClick={() => toggle("sources", s.id)}>{s.name}</Chip>)}</div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assigné à</p>
            <div className="flex flex-wrap gap-2">
              <Chip active={params.assigned.includes("none")} onClick={() => toggle("assigned", "none")}>Non assigné</Chip>
              {meta.members.map((m) => <Chip key={m.id} active={params.assigned.includes(m.id)} onClick={() => toggle("assigned", m.id)}>{m.name}</Chip>)}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Créé à partir du
              <Input type="date" aria-label="Créé à partir du" value={params.from ?? ""} onChange={(e) => setParams({ ...params, from: e.target.value || undefined, page: 1 })} />
            </label>
            <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Jusqu&apos;au
              <Input type="date" aria-label="Créé jusqu'au" value={params.to ?? ""} onChange={(e) => setParams({ ...params, to: e.target.value || undefined, page: 1 })} />
            </label>
            {filterable.map((f) => (
              <label key={f.id} className="space-y-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}
                {f.type === "select" ? (
                  <Select aria-label={`Filtrer par ${f.label}`} value={params.custom[f.key] ?? ""} onChange={(e) => {
                    const custom = { ...params.custom };
                    if (e.target.value) custom[f.key] = e.target.value; else delete custom[f.key];
                    setParams({ ...params, custom, page: 1 });
                  }}>
                    <option value="">Tous</option>
                    {(f.options?.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                ) : (
                  <Input aria-label={`Filtrer par ${f.label}`} value={params.custom[f.key] ?? ""} onChange={(e) => {
                    const custom = { ...params.custom };
                    if (e.target.value) custom[f.key] = e.target.value; else delete custom[f.key];
                    setParams({ ...params, custom, page: 1 });
                  }} />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {active && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtres actifs">
          {params.statuses.map((id) => <Badge key={id}>{meta.statuses.find((s) => s.id === id)?.name}</Badge>)}
          {params.sources.map((id) => <Badge key={id}>{id === "none" ? "Sans source" : meta.sources.find((s) => s.id === id)?.name}</Badge>)}
          {params.assigned.map((id) => <Badge key={id}>{id === "none" ? "Non assigné" : meta.members.find((m) => m.id === id)?.name}</Badge>)}
          {params.from && <Badge>Depuis le {params.from}</Badge>}
          {params.to && <Badge>Jusqu&apos;au {params.to}</Badge>}
          {Object.entries(params.custom).map(([k, v]) => <Badge key={k}>{meta.fields.find((f) => f.key === k)?.label ?? k} : {v}</Badge>)}
          {params.q && <Badge>« {params.q} »</Badge>}
          <Button size="sm" variant="ghost" onClick={clear}><X className="size-3.5" /> Tout effacer</Button>
        </div>
      )}

      {ready && (view === "kanban" ? (
        <KanbanBoard meta={meta} params={params} onCreate={(statusId) => setCreating({ statusId })} />
      ) : (
        <LeadsTable meta={meta} params={params} setParams={setParams} onCreate={() => setCreating({})} />
      ))}
      <LeadFormDialog key={creating?.statusId ?? "none"} meta={meta} open={creating !== null} onOpenChange={(o) => !o && setCreating(null)} defaultStatusId={creating?.statusId} />
    </div>
  );
}
