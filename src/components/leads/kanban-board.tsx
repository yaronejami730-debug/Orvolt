"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, MoveRight, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { createLeadAction, listKanbanAction, moveLeadAction } from "@/app/(app)/leads/actions";
import { listNextAppointmentsAction } from "@/app/(app)/agenda/actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { canMoveClient, leadName, type LeadRow, type LeadsMeta, type MetaStatus } from "@/lib/leads/types";
import type { ListParams } from "@/lib/validation/leads";
import { cn } from "@/lib/utils";
import { ago, daysSince, eur } from "./format";
import { hasFilters } from "./ui-params";

type Data = { rows: LeadRow[]; total: number };
const STAGNANT_DAYS = 7;

function Card({ lead, meta, overlay, onMove, rolledBack, nextAppt }: { lead: LeadRow; meta: LeadsMeta; overlay?: boolean; onMove: (to: string) => void; rolledBack: boolean; nextAppt?: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id, disabled: !meta.can.edit, data: { statusId: lead.status_id } });
  const source = meta.sources.find((s) => s.id === lead.source_id);
  const assignee = meta.members.find((m) => m.id === lead.assigned_to);
  const stale = daysSince(lead.updated_at) > STAGNANT_DAYS && meta.statuses.find((s) => s.id === lead.status_id)?.kind === "normal";
  return (
    <li
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : { transform: CSS.Transform.toString(transform), transition }}
      data-testid={`lead-card-${leadName(lead)}`}
      className={cn(
        "group rounded-lg border bg-card p-3 shadow-sm",
        isDragging && "opacity-40",
        overlay && "rotate-2 cursor-grabbing shadow-lg",
        rolledBack && "animate-[lf-shake_0.4s_ease-in-out]",
      )}
      role="listitem"
    >
      <div className="flex items-start justify-between gap-2">
        {meta.can.edit && !overlay && (
          <button ref={setActivatorNodeRef} type="button" aria-label={`Glisser ${leadName(lead)}`} className="-ml-1 inline-flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground sm:size-8 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" {...attributes} {...listeners}>
            <GripVertical className="size-4" />
          </button>
        )}
        <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1 break-words text-sm font-medium hover:underline">
          {leadName(lead)}
        </Link>
        {meta.can.edit && !overlay && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label={`Déplacer ${leadName(lead)} vers…`} className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:size-8 focus-visible:outline-2 focus-visible:outline-ring">
                <MoveRight className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Déplacer vers…</DropdownMenuLabel>
              {meta.statuses.filter((s) => s.id !== lead.status_id).map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => onMove(s.id)} className={cn("min-h-10 sm:min-h-8", !canMoveClient(meta, lead.status_id, s.id) && "text-muted-foreground")}>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} /> {s.name}
                  {!canMoveClient(meta, lead.status_id, s.id) && <span className="ml-auto text-[10px]">non autorisé</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {source && <Badge>{source.name}</Badge>}
        {lead.value !== null && <span className="text-xs font-medium tabular-nums">{eur(lead.value)}</span>}
        {nextAppt && (
          <Badge tone="accent" data-testid="appt-badge"><CalendarDays className="mr-1 size-3" aria-hidden />{new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(nextAppt))}</Badge>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={cn("text-muted-foreground", stale && "font-medium text-destructive-text")}>{ago(lead.created_at)}</span>
        {assignee && <Avatar name={assignee.name} size="sm" />}
      </div>
    </li>
  );
}

function Column({ status, leads, meta, children, onQuickAdd }: { status: MetaStatus; leads: LeadRow[]; meta: LeadsMeta; children: React.ReactNode; onQuickAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status.id}`, data: { statusId: status.id } });
  const final = status.kind !== "normal";
  return (
    <section
      id={`col-${status.id}`}
      aria-label={`Colonne ${status.name}`}
      data-testid={`col-${status.name}`}
      className={cn(
        "flex max-h-[calc(100dvh-14rem)] w-[85vw] shrink-0 snap-start flex-col rounded-xl border bg-muted/30 sm:w-72",
        status.kind === "won" && "border-success/40 bg-success/5",
        status.kind === "lost" && "border-destructive/40 bg-destructive/5",
        isOver && "ring-2 ring-accent",
      )}
    >
      <header className="flex items-center gap-2 p-3">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{status.name}</h3>
        <Badge>{leads.length}</Badge>
        {meta.can.create && !final && (
          <Button size="icon" variant="ghost" className="size-7" aria-label={`Ajouter un lead dans ${status.name}`} onClick={onQuickAdd}><Plus className="size-4" /></Button>
        )}
      </header>
      <ul ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
        {children}
        {leads.length === 0 && <li className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-4 text-xs text-muted-foreground">Déposer ici</li>}
      </ul>
    </section>
  );
}

function QuickAdd({ status, meta, onDone, onMore }: { status: MetaStatus; meta: LeadsMeta; onDone: () => void; onMore: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [pending, start] = useTransition();
  const qc = useQueryClient();
  return (
    <form
      className="mx-2 mb-2 space-y-2 rounded-lg border bg-card p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const [first, ...rest] = name.trim().split(/\s+/);
        start(async () => {
          const res = await createLeadAction({ firstName: rest.length ? first : "", lastName: rest.length ? rest.join(" ") : (first ?? ""), phone: phone || null, sourceId: source || null, statusId: status.id });
          if (res.ok) { toast.success("Lead créé."); setName(""); setPhone(""); onDone(); qc.invalidateQueries({ queryKey: ["leads"] }); }
          else toast.error(res.error ?? "Création impossible.", { action: { label: "Plus de champs", onClick: onMore } });
        });
      }}
    >
      <Input autoFocus aria-label="Nom du lead" placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
      <Input aria-label="Téléphone" placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9" />
      <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className="h-9">
        <option value="">Source</option>
        {meta.sources.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending} className="flex-1">Ajouter</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onMore}>Plus de champs</Button>
      </div>
    </form>
  );
}

export function KanbanBoard({ meta, params, onCreate }: { meta: LeadsMeta; params: ListParams; onCreate: (statusId?: string) => void }) {
  const qc = useQueryClient();
  const key = useMemo(() => ["leads", "kanban", params] as const, [params]);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await listKanbanAction(params);
      if (!r.ok || !r.data) throw new Error(r.error ?? "Chargement impossible.");
      return r.data;
    },
  });
  const nextQ = useQuery({
    enabled: !!meta.can.appointments,
    queryKey: ["leads", "appts"],
    queryFn: async () => (await listNextAppointmentsAction()).data?.next ?? {},
  });
  const [active, setActive] = useState<LeadRow | null>(null);
  const [quickFor, setQuickFor] = useState<string | null>(null);
  const [rolledBack, setRolledBack] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const move = useMutation({
    mutationFn: async (v: { leadId: string; toStatusId: string; position: number }) => {
      const r = await moveLeadAction(v);
      if (!r.ok) throw Object.assign(new Error(r.error ?? "Déplacement impossible."), { code: r.code });
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["leads", "kanban"] });
      const previous = qc.getQueryData<Data>(key);
      qc.setQueryData<Data>(key, (d) => d && { ...d, rows: d.rows.map((l) => (l.id === v.leadId ? { ...l, status_id: v.toStatusId, position: v.position } : l)) });
      return { previous, leadId: v.leadId };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      setRolledBack(ctx?.leadId ?? null);
      setTimeout(() => setRolledBack(null), 600);
      toast.error(e.message, ["transition_forbidden", "final_status"].includes((e as { code?: string }).code ?? "") ? undefined : { action: { label: "Réessayer", onClick: () => move.mutate(_v) } });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      // Les actions automatiques s'exécutent en différé côté serveur.
      setTimeout(() => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["leads"] }); }, 1500);
    },
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byStatus = useMemo(() => {
    const m = new Map<string, LeadRow[]>();
    for (const s of meta.statuses) m.set(s.id, []);
    for (const l of rows) m.get(l.status_id)?.push(l);
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [rows, meta.statuses]);
  const ordered = [...meta.statuses.filter((s) => s.kind === "normal"), ...meta.statuses.filter((s) => s.kind === "won"), ...meta.statuses.filter((s) => s.kind === "lost")];

  function moveTo(lead: LeadRow, toStatusId: string, index?: number) {
    const target = (byStatus.get(toStatusId) ?? []).filter((l) => l.id !== lead.id);
    const i = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
    const before = target[i - 1]?.position, after = target[i]?.position;
    const position = before !== undefined && after !== undefined ? (before + after) / 2 : before !== undefined ? before + 1 : after !== undefined ? after - 1 : Date.now() / 1000;
    if (lead.status_id === toStatusId && lead.position === position) return;
    move.mutate({ leadId: lead.id, toStatusId, position });
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const lead = rows.find((l) => l.id === e.active.id);
    if (!lead || !e.over) return;
    const overId = String(e.over.id);
    if (overId.startsWith("col:")) return moveTo(lead, overId.slice(4));
    const overLead = rows.find((l) => l.id === overId);
    if (!overLead || overLead.id === lead.id) return;
    const col = (byStatus.get(overLead.status_id) ?? []).filter((l) => l.id !== lead.id);
    moveTo(lead, overLead.status_id, col.findIndex((l) => l.id === overLead.id));
  }

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-72 shrink-0 space-y-2 rounded-xl border p-3">
            <Skeleton className="h-5 w-24" />
            {[0, 1, 2].map((j) => <Skeleton key={j} className="h-20 w-full" />)}
          </div>
        ))}
      </div>
    );
  }
  if (isError) {
    return <EmptyState title="Chargement impossible" description="Une erreur est survenue." action={<Button onClick={() => refetch()}>Réessayer</Button>} />;
  }
  if (rows.length === 0 && !hasFilters(params)) {
    return (
      <EmptyState icon={Users} title="Aucun lead" description="Créez votre premier lead ou importez un fichier CSV."
        action={<div className="flex gap-2">{meta.can.create && <Button onClick={() => onCreate()}>Créer un lead</Button>}<Button variant="outline" asChild><Link href="/import">Importer un CSV</Link></Button></div>} />
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon={Users} title="Aucun résultat" description="Aucun lead ne correspond à ces filtres." />;
  }

  return (
    <div className="space-y-2">
      <nav aria-label="Colonnes" className="flex justify-center gap-2 sm:hidden">
        {ordered.map((s) => (
          <button key={s.id} aria-label={`Aller à ${s.name}`} className="size-2.5 rounded-full" style={{ backgroundColor: s.color }}
            onClick={() => document.getElementById(`col-${s.id}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })} />
        ))}
      </nav>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e: DragStartEvent) => setActive(rows.find((l) => l.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3" data-testid="kanban">
          {ordered.map((s) => {
            const list = byStatus.get(s.id) ?? [];
            return (
              <Column key={s.id} status={s} leads={list} meta={meta} onQuickAdd={() => setQuickFor(quickFor === s.id ? null : s.id)}>
                {quickFor === s.id && <QuickAdd status={s} meta={meta} onDone={() => setQuickFor(null)} onMore={() => { setQuickFor(null); onCreate(s.id); }} />}
                <SortableContext items={list.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                  {list.map((l) => <Card key={l.id} lead={l} meta={meta} nextAppt={nextQ.data?.[l.id]} rolledBack={rolledBack === l.id} onMove={(to) => moveTo(l, to)} />)}
                </SortableContext>
              </Column>
            );
          })}
        </div>
        <DragOverlay>{active ? <Card lead={active} meta={meta} overlay rolledBack={false} onMove={() => undefined} /> : null}</DragOverlay>
      </DndContext>
      {meta.can.create && (
        <Button className="fixed bottom-20 right-4 z-30 size-12 rounded-full shadow-lg sm:hidden" size="icon" aria-label="Nouveau lead" onClick={() => onCreate()}><Plus className="size-5" /></Button>
      )}
    </div>
  );
}
