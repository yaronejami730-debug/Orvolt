"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { listAppointmentsAction, type ApptRow } from "@/app/(app)/agenda/actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setAppointmentStatusAction } from "@/app/(app)/agenda/actions";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { AppointmentDialog } from "./appointment-dialog";
import { DIST_LABEL, fmtDay, fmtFull, fmtTime, STATUS_COLOR, STATUS_LABEL } from "./status";

type View = "week" | "day" | "month" | "list";
const H0 = 7, H1 = 20, PX = 48; // grille 7h-20h, 48 px / heure (créneaux de 30 min)
const VIEW_KEY = "lf_agenda_view";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Col { key: string; label: string; day: Date; userId?: string }

function lanes(items: ApptRow[]) {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const out: { a: ApptRow; lane: number; of: number }[] = [];
  let cluster: { a: ApptRow; lane: number; end: number }[] = [];
  const flush = () => { const of = Math.max(1, ...cluster.map((c) => c.lane + 1)); cluster.forEach((c) => out.push({ a: c.a, lane: c.lane, of })); cluster = []; };
  for (const a of sorted) {
    const s = new Date(a.starts_at).getTime();
    if (cluster.length && cluster.every((c) => c.end <= s)) flush();
    let lane = 0;
    while (cluster.some((c) => c.lane === lane && c.end > s)) lane++;
    cluster.push({ a, lane, end: new Date(a.ends_at).getTime() });
  }
  flush();
  return out;
}

export function AgendaView({ members, userId, canAll, memberColors }: { members: { id: string; name: string }[]; userId: string; canAll: boolean; memberColors: Record<string, string> }) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [users, setUsers] = useState<string[]>([userId]);
  const [ready, setReady] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [dayUser, setDayUser] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ start: Date; assignee: string } | null>(null);
  const [detail, setDetail] = useState<ApptRow | null>(null);
  const [editing, setEditing] = useState<ApptRow | null>(null);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    let stored: string | null = null;
    try { stored = localStorage.getItem(VIEW_KEY); } catch { /* facultatif */ }
    const v = (u.get("view") ?? stored ?? (window.innerWidth < 768 ? "day" : "week")) as View;
    setView(["week", "day", "month", "list"].includes(v) ? v : "week");
    const d = u.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setAnchor(startOfDay(new Date(`${d}T00:00:00`)));
    const us = u.get("users");
    if (canAll && us) setUsers(us.split(",").filter((id) => members.some((m) => m.id === id)));
    else if (canAll) setUsers(members.map((m) => m.id));
    setMobile(window.innerWidth < 768);
    setReady(true);
    // Initialisation unique depuis l'URL : relancer cet effet (props recréées par le routeur) bouclait avec replaceState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // La vue est mémorisée (localStorage) ; l'URL (?view=&date=&users=) est lue au chargement pour les liens directs.
  // On ne réécrit pas l'URL : une navigation déclenchée pendant qu'une server action est en vol la laisse en attente.
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* facultatif */ }
  }, [view, ready]);

  const range = useMemo(() => {
    if (view === "week") return [startOfWeek(anchor), addDays(startOfWeek(anchor), 7)] as const;
    if (view === "day") return [anchor, addDays(anchor, 1)] as const;
    if (view === "list") return [anchor, addDays(anchor, 30)] as const;
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return [startOfWeek(first), addDays(startOfWeek(first), 42)] as const;
  }, [view, anchor]);

  const q = useQuery({
    enabled: ready && users.length > 0,
    queryKey: ["appts", range[0].toISOString(), range[1].toISOString(), users],
    queryFn: async () => {
      const r = await listAppointmentsAction({ from: range[0].toISOString(), to: range[1].toISOString(), userIds: users });
      if (!r.ok || !r.data) throw new Error(r.error ?? "Chargement impossible.");
      return r.data.rows;
    },
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "—";

  const step = (dir: number) => setAnchor((a) => (view === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * (view === "week" ? 7 : view === "list" ? 30 : 1))));
  const title = view === "month" ? new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(anchor)
    : view === "day" ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(anchor)
    : `${fmtDay(range[0])} – ${fmtDay(addDays(range[1], -1))}`;

  const cols: Col[] = useMemo(() => {
    if (view === "day") {
      if (mobile && canAll && users.length > 1) {
        // Mobile : une seule colonne à la fois (sélecteur de commercial) plutôt que des colonnes coupées.
        const id = dayUser && users.includes(dayUser) ? dayUser : users[0]!;
        return [{ key: id, label: members.find((m) => m.id === id)?.name ?? "—", day: anchor, userId: id }];
      }
      return canAll && users.length > 1
        ? users.map((id) => ({ key: id, label: members.find((m) => m.id === id)?.name ?? "—", day: anchor, userId: id }))
        : [{ key: "d", label: fmtDay(anchor), day: anchor, userId: users[0] }];
    }
    return Array.from({ length: 7 }, (_, i) => { const d = addDays(range[0], i); return { key: ymd(d), label: fmtDay(d), day: d }; });
  }, [view, anchor, users, canAll, members, range, mobile, dayUser]);

  const newAt = (day: Date, minutes: number, uid?: string) => {
    const s = new Date(day); s.setHours(0, minutes, 0, 0);
    setCreating({ start: s, assignee: uid ?? (users.length === 1 ? users[0]! : userId) });
  };
  const today = new Date();
  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);

  function setStatus(a: ApptRow, status: ApptRow["status"]) {
    setAppointmentStatusAction({ id: a.id, status }).then((r) => { if (r.ok) { toast.success("Rendez-vous mis à jour."); setDetail(null); qc.invalidateQueries({ queryKey: ["appts"] }); } else toast.error(r.error); });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Précédent" onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button>
        <Button variant="outline" onClick={() => setAnchor(startOfDay(new Date()))}>Aujourd&apos;hui</Button>
        <Button variant="outline" size="icon" aria-label="Suivant" onClick={() => step(1)}><ChevronRight className="size-4" /></Button>
        <h2 className="min-w-0 flex-1 text-base font-semibold capitalize sm:text-lg" data-testid="agenda-title">{title}</h2>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="week">Semaine</TabsTrigger>
            <TabsTrigger value="day">Jour</TabsTrigger>
            <TabsTrigger value="month">Mois</TabsTrigger>
            <TabsTrigger value="list">Liste</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => newAt(anchor, 9 * 60)} className="max-sm:hidden"><Plus className="size-4" /> Nouveau RDV</Button>
      </div>

      {canAll && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Commerciaux">
          <button type="button" aria-pressed={users.length === members.length} onClick={() => setUsers(users.length === members.length ? [userId] : members.map((m) => m.id))}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", users.length === members.length && "border-accent bg-accent-soft text-link")}>Tous</button>
          {members.map((m) => (
            <button key={m.id} type="button" aria-pressed={users.includes(m.id)} onClick={() => setUsers((u) => (u.includes(m.id) ? u.filter((x) => x !== m.id) : [...u, m.id]))}
              className={cn("flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium", users.includes(m.id) && "border-accent bg-accent-soft text-link")}>
              <span className="size-2 rounded-full" style={{ backgroundColor: memberColors[m.id] }} aria-hidden />{m.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Légende">
        {(Object.keys(STATUS_LABEL) as ApptRow["status"][]).map((s) => <span key={s} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>)}
      </div>

      {view === "day" && mobile && canAll && users.length > 1 && (
        <label className="flex items-center gap-2 text-sm">Commercial
          <select aria-label="Commercial affiché" className="h-9 flex-1 rounded-md border border-input bg-card px-2" value={dayUser && users.includes(dayUser) ? dayUser : users[0]} onChange={(e) => setDayUser(e.target.value)}>
            {users.map((id) => <option key={id} value={id}>{name(id)}</option>)}
          </select>
        </label>
      )}
      {q.isLoading ? <Skeleton className="h-96 w-full" /> : q.isError ? (
        <EmptyState title="Chargement impossible" action={<Button onClick={() => q.refetch()}>Réessayer</Button>} />
      ) : view === "month" ? (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-sm" data-testid="month-grid">
          {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <div key={d} className="bg-muted/50 p-2 text-center text-xs font-medium">{d}</div>)}
          {Array.from({ length: 42 }, (_, i) => addDays(range[0], i)).map((d) => {
            const n = rows.filter((r) => sameDay(new Date(r.starts_at), d) && r.status !== "cancelled").length;
            return (
              <button key={d.toISOString()} onClick={() => { setAnchor(d); setView("day"); }} aria-label={`${fmtDay(d)} : ${n} rendez-vous`}
                className={cn("flex min-h-14 flex-col items-center gap-1 bg-card p-1 hover:bg-muted/50", d.getMonth() !== anchor.getMonth() && "text-muted-foreground opacity-50", sameDay(d, today) && "font-semibold text-link")}>
                <span>{d.getDate()}</span>
                {n > 0 && <span className="flex gap-0.5">{Array.from({ length: Math.min(n, 4) }, (_, k) => <span key={k} className="size-1.5 rounded-full bg-accent" />)}</span>}
              </button>
            );
          })}
        </div>
      ) : view === "list" ? (
        rows.length === 0 ? <EmptyState title="Aucun rendez-vous" description="Aucun rendez-vous sur la période." /> : (
          <ul className="space-y-4" data-testid="agenda-list">
            {Object.entries(rows.reduce<Record<string, ApptRow[]>>((acc, r) => { (acc[ymd(new Date(r.starts_at))] ??= []).push(r); return acc; }, {})).map(([day, list]) => (
              <li key={day}>
                <h3 className="mb-2 text-sm font-semibold capitalize">{fmtDay(new Date(`${day}T00:00:00`))}</h3>
                <ul className="space-y-2">{list.map((a) => (
                  <li key={a.id}><button onClick={() => setDetail(a)} data-testid="agenda-item" className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left text-sm hover:border-muted-foreground/60">
                    <span className="w-24 shrink-0 font-medium tabular-nums">{fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</span>
                    <span className="min-w-0 flex-1 truncate">{a.lead_name}{a.location_address && <span className="text-muted-foreground"> · {a.location_address}</span>}</span>
                    <Badge color={STATUS_COLOR[a.status]} dot>{STATUS_LABEL[a.status]}</Badge>
                    {a.distance_status === "over_radius" && <AlertTriangle className="size-4 text-warning-text" aria-label="Hors zone" />}
                  </button></li>
                ))}</ul>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card" data-testid="agenda-grid">
          <div className="grid min-w-[40rem]" style={{ gridTemplateColumns: `3.5rem repeat(${cols.length}, minmax(0, 1fr))` }}>
            <div />
            {cols.map((c) => <div key={c.key} className={cn("border-b border-l p-2 text-center text-xs font-medium capitalize", sameDay(c.day, today) && "text-link")}>{c.label}</div>)}
            <div className="relative" style={{ height: (H1 - H0) * PX }}>
              {hours.map((h) => <div key={h} className="absolute right-1 -translate-y-2 text-[10px] text-muted-foreground" style={{ top: (h - H0) * PX }}>{h}:00</div>)}
            </div>
            {cols.map((c) => {
              const list = rows.filter((r) => sameDay(new Date(r.starts_at), c.day) && (c.userId ? r.assigned_to === c.userId : true));
              return (
                <div key={c.key} className="relative border-l" style={{ height: (H1 - H0) * PX }}>
                  {Array.from({ length: (H1 - H0) * 2 }, (_, i) => (
                    <button key={i} aria-label={`Créer un rendez-vous le ${fmtDay(c.day)} à ${H0 + Math.floor(i / 2)}h${i % 2 ? "30" : "00"}`} onClick={() => newAt(c.day, (H0 + Math.floor(i / 2)) * 60 + (i % 2) * 30, c.userId)}
                      className={cn("absolute inset-x-0 border-t hover:bg-accent-soft", i % 2 ? "border-dashed" : "")} style={{ top: i * (PX / 2), height: PX / 2 }} />
                  ))}
                  {sameDay(c.day, today) && today.getHours() >= H0 && today.getHours() < H1 && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive" style={{ top: ((today.getHours() - H0) * 60 + today.getMinutes()) / 60 * PX }} aria-hidden />
                  )}
                  {lanes(list).map(({ a, lane, of }) => {
                    const s = new Date(a.starts_at), e = new Date(a.ends_at);
                    const top = Math.max(0, ((s.getHours() - H0) * 60 + s.getMinutes()) / 60 * PX);
                    const h = Math.max(22, (e.getTime() - s.getTime()) / 3_600_000 * PX);
                    return (
                      <button key={a.id} data-testid="agenda-event" onClick={() => setDetail(a)} title={`${a.lead_name} — ${name(a.assigned_to)}`}
                        className={cn("absolute z-[5] overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight text-foreground shadow-sm", a.status === "cancelled" && "line-through opacity-60")}
                        style={{ top, height: h, left: `${(lane / of) * 100}%`, width: `${100 / of - 1}%`, borderLeftColor: STATUS_COLOR[a.status], backgroundColor: `${STATUS_COLOR[a.status]}22` }}>
                        <span className="font-medium">{fmtTime(s)}</span> {a.lead_name}
                        {a.distance_status === "over_radius" && <AlertTriangle className="ml-1 inline size-3 text-warning-text" aria-label="Hors zone" />}
                        <span className="block truncate text-muted-foreground">{a.location_address}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {rows.length === 0 && <p className="border-t p-4 text-center text-sm text-muted-foreground">Aucun rendez-vous sur cette période.</p>}
        </div>
      )}

      <Button className="fixed bottom-20 right-4 z-30 size-12 rounded-full shadow-lg sm:hidden" size="icon" aria-label="Nouveau rendez-vous" onClick={() => newAt(anchor, 9 * 60)}><Plus className="size-5" /></Button>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.lead_name}</DialogTitle>
                <DialogDescription>{fmtFull(detail.starts_at)} – {fmtTime(detail.ends_at)}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm" data-testid="appt-detail">
                <p className="flex items-center gap-2"><Avatar name={name(detail.assigned_to)} size="sm" />{name(detail.assigned_to)}</p>
                {detail.location_address && <p>{detail.location_address}</p>}
                <div className="flex flex-wrap gap-2">
                  <Badge color={STATUS_COLOR[detail.status]} dot>{STATUS_LABEL[detail.status]}</Badge>
                  <Badge tone={detail.distance_status === "ok" ? "success" : detail.distance_status === "over_radius" ? "warning" : "neutral"}>{DIST_LABEL[detail.distance_status]}{detail.distance_km !== null && detail.distance_status !== "no_zone" ? ` · ${detail.distance_km} km` : ""}</Badge>
                  {detail.distance_override && <Badge tone="warning">Dérogation : {detail.override_reason}</Badge>}
                </div>
                {detail.notes && <p className="whitespace-pre-wrap text-muted-foreground">{detail.notes}</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" asChild><Link href={`/leads/${detail.lead_id}`}>Ouvrir la fiche</Link></Button>
                <Button variant="outline" onClick={() => { setEditing(detail); setDetail(null); }}>Modifier</Button>
                {detail.status !== "cancelled" && <Button variant="destructive" onClick={() => setStatus(detail, "cancelled")}>Annuler</Button>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {creating && (
        <AppointmentDialog key={creating.start.toISOString() + creating.assignee} open onOpenChange={(o) => !o && setCreating(null)} members={members} userId={userId} canAssignOthers={canAll}
          defaultStart={creating.start} defaultAssignee={creating.assignee} />
      )}
      {editing && (
        <AppointmentDialog key={editing.id} open onOpenChange={(o) => !o && setEditing(null)} members={members} userId={userId} canAssignOthers={canAll} editing={editing} lead={{ id: editing.lead_id, label: editing.lead_name, address: editing.location_address ?? "", assignedTo: editing.assigned_to }} />
      )}
    </div>
  );
}
