"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { bulkAssignAction, bulkDeleteAction, bulkMoveAction, listLeadsAction } from "@/app/(app)/leads/actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { leadName, type LeadRow, type LeadsMeta } from "@/lib/leads/types";
import { SORT_COLUMNS, type ListParams } from "@/lib/validation/leads";
import { cn } from "@/lib/utils";
import { dateFr, eur } from "./format";
import { hasFilters } from "./ui-params";

type Sort = (typeof SORT_COLUMNS)[number];
const COLS_KEY = "lf_leads_cols";

function SortHead({ col, label, params, onSort }: { col: Sort; label: string; params: ListParams; onSort: (c: Sort) => void }) {
  const active = params.sort === col;
  return (
    <TableHead aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"} className="max-md:hidden">
      <button className="inline-flex items-center gap-1 uppercase hover:text-foreground" onClick={() => onSort(col)}>
        {label}
        {active && (params.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </TableHead>
  );
}

export function LeadsTable({ meta, params, setParams, onCreate }: { meta: LeadsMeta; params: ListParams; setParams: (p: ListParams) => void; onCreate: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["leads", "table", params],
    queryFn: async () => {
      const r = await listLeadsAction(params);
      if (!r.ok || !r.data) throw new Error(r.error ?? "Chargement impossible.");
      return r.data;
    },
    placeholderData: (prev) => prev,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    try { setCols(JSON.parse(localStorage.getItem(COLS_KEY) ?? "[]")); } catch { /* préférence facultative */ }
  }, []);
  useEffect(() => setSelected([]), [params]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / params.pageSize));
  const status = (id: string) => meta.statuses.find((s) => s.id === id);
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const extra = useMemo(() => meta.fields.filter((f) => cols.includes(f.key) && f.type !== "file"), [meta.fields, cols]);
  const toggleCol = (k: string) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k];
    setCols(next);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignoré */ }
  };
  const onSort = (c: Sort) => setParams({ ...params, sort: c, dir: params.sort === c && params.dir === "asc" ? "desc" : "asc", page: 1 });

  function report(res: { ok: boolean; error?: string; data?: { done: number; failed: { id: string; error: string }[] } }, verb: string) {
    const d = res.data;
    if (d && d.failed.length === 0) toast.success(`${d.done} lead(s) ${verb}.`);
    else if (d && d.done > 0) toast.warning(`${d.done} ${verb}, ${d.failed.length} refusé(s) : ${[...new Set(d.failed.map((f) => f.error))].join(" ; ")}`);
    else toast.error(res.error ?? "Opération refusée.");
    setSelected([]);
    qc.invalidateQueries({ queryKey: ["leads"] });
  }

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (isError) return <EmptyState title="Chargement impossible" description="Une erreur est survenue." action={<Button onClick={() => refetch()}>Réessayer</Button>} />;
  if (total === 0 && !hasFilters(params)) {
    return <EmptyState icon={Users} title="Aucun lead" description="Créez votre premier lead ou importez un fichier CSV."
      action={<div className="flex gap-2">{meta.can.create && <Button onClick={onCreate}>Créer un lead</Button>}<Button variant="outline" asChild><Link href="/import">Importer un CSV</Link></Button></div>} />;
  }
  if (total === 0) return <EmptyState icon={Users} title="Aucun résultat" description="Aucun lead ne correspond à ces filtres." action={<Button variant="outline" onClick={() => setParams({ ...params, statuses: [], sources: [], assigned: [], from: undefined, to: undefined, q: undefined, custom: {}, page: 1 })}>Effacer les filtres</Button>} />;

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-popover p-3 shadow-md" role="region" aria-label="Actions groupées">
          <span className="text-sm font-medium">{selected.length} sélectionné(s)</span>
          {meta.can.edit && (
            <>
              <Select aria-label="Changer le statut" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="h-9 w-44">
                <option value="">Changer le statut…</option>
                {meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Button size="sm" variant="outline" disabled={!bulkStatus} loading={pending} onClick={() => start(async () => { report(await bulkMoveAction({ ids: selected, toStatusId: bulkStatus }), "déplacé(s)"); setBulkStatus(""); })}>Appliquer</Button>
              <Select aria-label="Assigner à" value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)} className="h-9 w-44">
                <option value="">Assigner à…</option>
                <option value="none">Personne</option>
                {meta.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <Button size="sm" variant="outline" disabled={!bulkAssignee} loading={pending} onClick={() => start(async () => { report(await bulkAssignAction({ ids: selected, assignedTo: bulkAssignee === "none" ? null : bulkAssignee }), "assigné(s)"); setBulkAssignee(""); })}>Assigner</Button>
            </>
          )}
          {meta.can.delete && <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5" /> Supprimer</Button>}
        </div>
      )}
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Columns3 className="size-4" /> Colonnes</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Champs personnalisés</DropdownMenuLabel>
            {meta.fields.filter((f) => f.type !== "file").length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">Aucun champ.</p>}
            {meta.fields.filter((f) => f.type !== "file").map((f) => (
              <DropdownMenuItem key={f.id} onSelect={(e) => { e.preventDefault(); toggleCol(f.key); }}>
                <Checkbox checked={cols.includes(f.key)} aria-label={f.label} tabIndex={-1} /> {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Table className="max-md:block">
        <TableHeader className="max-md:hidden">
          <TableRow>
            <TableHead className="w-10"><Checkbox aria-label="Tout sélectionner" checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? rows.map((r) => r.id) : [])} /></TableHead>
            <SortHead col="last_name" label="Nom" params={params} onSort={onSort} />
            <SortHead col="status_id" label="Statut" params={params} onSort={onSort} />
            <TableHead className="max-md:hidden">Source</TableHead>
            <SortHead col="assigned_to" label="Assigné" params={params} onSort={onSort} />
            <SortHead col="value" label="Valeur" params={params} onSort={onSort} />
            <SortHead col="created_at" label="Créé le" params={params} onSort={onSort} />
            {extra.map((f) => <TableHead key={f.id} className="max-md:hidden">{f.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody className="max-md:block">
          {rows.map((l: LeadRow) => {
            const st = status(l.status_id);
            const as = meta.members.find((m) => m.id === l.assigned_to);
            return (
              <TableRow key={l.id} data-testid={`lead-row-${leadName(l)}`} className="max-md:grid max-md:grid-cols-[auto_1fr_auto] max-md:items-center max-md:gap-2 max-md:p-3">
                <TableCell className="max-md:p-0"><Checkbox aria-label={`Sélectionner ${leadName(l)}`} checked={selected.includes(l.id)} onCheckedChange={(v) => setSelected((c) => (v === true ? [...c, l.id] : c.filter((x) => x !== l.id)))} /></TableCell>
                <TableCell className="whitespace-normal max-md:p-0"><Link href={`/leads/${l.id}`} className="font-medium hover:underline">{leadName(l)}</Link><span className="block text-xs text-muted-foreground">{l.phone ?? l.email ?? ""}</span></TableCell>
                <TableCell className="max-md:p-0">{st && <Badge color={st.color} dot>{st.name}</Badge>}</TableCell>
                <TableCell className="max-md:hidden">{meta.sources.find((s) => s.id === l.source_id)?.name ?? "—"}</TableCell>
                <TableCell className="max-md:hidden">{as ? <span className="flex items-center gap-2"><Avatar name={as.name} size="sm" />{as.name}</span> : "—"}</TableCell>
                <TableCell className={cn("tabular-nums max-md:hidden")}>{eur(l.value) || "—"}</TableCell>
                <TableCell className="max-md:hidden">{dateFr(l.created_at)}</TableCell>
                {extra.map((f) => <TableCell key={f.id} className="max-md:hidden">{Array.isArray(l.custom[f.key]) ? (l.custom[f.key] as string[]).join(", ") : String(l.custom[f.key] ?? "—")}</TableCell>)}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground" data-testid="total">{total} lead{total > 1 ? "s" : ""}</span>
        <div className="flex items-center gap-2">
          <Select aria-label="Lignes par page" value={params.pageSize} onChange={(e) => setParams({ ...params, pageSize: Number(e.target.value) as 25 | 50 | 100, page: 1 })} className="h-9 w-24">
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </Select>
          <Button size="icon" variant="outline" aria-label="Page précédente" disabled={params.page <= 1} onClick={() => setParams({ ...params, page: params.page - 1 })}><ChevronLeft className="size-4" /></Button>
          <span className="tabular-nums">{params.page} / {pages}</span>
          <Button size="icon" variant="outline" aria-label="Page suivante" disabled={params.page >= pages} onClick={() => setParams({ ...params, page: params.page + 1 })}><ChevronRight className="size-4" /></Button>
        </div>
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer {selected.length} lead(s) ?</DialogTitle>
            <DialogDescription>Cette action est irréversible : notes, appels et fichiers associés seront supprimés.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Annuler</Button>
            <Button variant="destructive" loading={pending} onClick={() => start(async () => { report(await bulkDeleteAction({ ids: selected }), "supprimé(s)"); setConfirmDelete(false); })}>Supprimer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
