"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BarChart3, Minus } from "lucide-react";
import { dashKpiAction, dashSourceAction, dashStatusAction, dashTimeAction, dashUsersAction, type SourceRow, type StatusRow, type TimeRow, type UserRow } from "@/app/(app)/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodError, resolvePeriod, shiftDay } from "@/lib/dashboard/period";
import { conversionRate, delta, deltaPoints, fmtEuro, fmtInt, fmtPercent, type Delta } from "@/lib/dashboard/format";
import type { DashParams } from "@/lib/validation/dashboard";
import { cn } from "@/lib/utils";

type Preset = DashParams["preset"];
const PRESETS: { id: Preset; label: string }[] = [
  { id: "7d", label: "7 jours" }, { id: "30d", label: "30 jours" }, { id: "90d", label: "90 jours" }, { id: "month", label: "Ce mois" }, { id: "custom", label: "Personnalisée" },
];

function useBlock<T>(name: string, params: DashParams, fn: (p: DashParams) => Promise<{ ok: boolean; data?: T; error?: string }>, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["dash", name, params],
    staleTime: 15_000,
    queryFn: async () => {
      const r = await fn(params);
      if (!r.ok || !r.data) throw new Error(r.error ?? "Données indisponibles.");
      return r.data;
    },
    retry: false,
  });
}

function Block({ title, q, children, empty, className }: { title: string; q: { isLoading: boolean; isError: boolean; refetch: () => void }; children: React.ReactNode; empty?: boolean; className?: string }) {
  return (
    <Card className={cn("min-w-0 space-y-3 p-5", className)} aria-busy={q.isLoading}>
      <h2 className="text-base font-semibold">{title}</h2>
      {q.isLoading ? <div className="space-y-2" aria-label="Chargement">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        : q.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"><span>Impossible de charger ce bloc.</span><Button size="sm" variant="outline" onClick={() => q.refetch()}>Réessayer</Button></div>
        : empty ? <p className="text-sm text-muted-foreground">Pas encore de données sur la période.</p>
        : children}
    </Card>
  );
}

function DeltaBadge({ d, suffix = "vs période préc." }: { d: Delta; suffix?: string }) {
  const Icon = d.direction === "up" ? ArrowUp : d.direction === "down" ? ArrowDown : Minus;
  const label = d.pct === null ? "Période préc. : 0" : `${d.pct > 0 ? "+" : ""}${d.pct} %`;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", d.direction === "up" && "text-success-text", d.direction === "down" && "text-destructive-text", d.direction === "flat" && "text-muted-foreground")}>
      <Icon className="size-3.5" aria-hidden />{label}{d.pct !== null && <> <span className="font-normal text-muted-foreground max-sm:hidden">{suffix}</span></>}
    </span>
  );
}

function Kpi({ label, value, hint, children, testid }: { label: string; value: string; hint?: string; children?: React.ReactNode; testid: string }) {
  return (
    <Card className="p-5" data-testid={testid}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums" data-testid={`${testid}-value`}>{value}</p>
      <div className="mt-2 space-y-1 text-xs">{children}{hint && <p className="text-muted-foreground">{hint}</p>}</div>
    </Card>
  );
}

const dayFmt = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function LineChart({ rows, bucket }: { rows: TimeRow[]; bucket: "day" | "week" }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 600, H = 180, P = 24;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.created, r.won)));
  const x = (i: number) => P + (rows.length <= 1 ? 0 : (i * (W - 2 * P)) / (rows.length - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (k: "created" | "won") => rows.map((r, i) => `${x(i)},${y(r[k])}`).join(" ");
  const a = active !== null ? rows[active] : null;
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Évolution des leads créés et gagnés : ${rows.reduce((s, r) => s + r.created, 0)} créés, ${rows.reduce((s, r) => s + r.won, 0)} gagnés`}>
        {[0, 0.5, 1].map((t) => <line key={t} x1={P} x2={W - P} y1={y(max * t)} y2={y(max * t)} stroke="var(--border)" />)}
        <text x={2} y={y(max) + 4} fontSize="10" fill="var(--muted-foreground)">{max}</text>
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={line("created")} />
        <polyline fill="none" stroke="var(--success)" strokeWidth="2" strokeDasharray="4 3" points={line("won")} />
        {rows.map((r, i) => (
          <circle key={r.bucket} cx={x(i)} cy={y(r.created)} r={rows.length > 40 ? 3 : 4} fill="var(--accent)" tabIndex={0} role="img" aria-label={`${bucket === "week" ? "Semaine du " : ""}${dayFmt(r.bucket)} : ${r.created} créés, ${r.won} gagnés`}
            onFocus={() => setActive(i)} onMouseEnter={() => setActive(i)} onBlur={() => setActive(null)} onMouseLeave={() => setActive(null)} className="outline-none focus-visible:stroke-foreground focus-visible:stroke-2" />
        ))}
        <text x={P} y={H - 4} fontSize="10" fill="var(--muted-foreground)">{rows[0] ? dayFmt(rows[0].bucket) : ""}</text>
        <text x={W - P} y={H - 4} fontSize="10" textAnchor="end" fill="var(--muted-foreground)">{rows.length ? dayFmt(rows[rows.length - 1]!.bucket) : ""}</text>
      </svg>
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{a ? `${bucket === "week" ? "Semaine du " : ""}${dayFmt(a.bucket)} : ${a.created} créé(s), ${a.won} gagné(s)` : "Survolez ou parcourez les points au clavier pour le détail."}</p>
      <div className="flex gap-4 text-xs"><span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-accent" />Créés</span><span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-success" />Gagnés</span></div>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Voir sous forme de tableau</summary>
        <div className="mt-2 max-h-56 overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left"><th className="p-1">{bucket === "week" ? "Semaine" : "Jour"}</th><th className="p-1">Créés</th><th className="p-1">Gagnés</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.bucket} className="border-t"><td className="p-1">{dayFmt(r.bucket)}</td><td className="p-1 tabular-nums">{r.created}</td><td className="p-1 tabular-nums">{r.won}</td></tr>)}</tbody></table></div>
      </details>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { won: "gagné", lost: "perdu", normal: "" };

function Bars({ items, hrefOf }: { items: { key: string; label: string; n: number; color: string; extra?: string }[]; hrefOf: (k: string) => string }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  const total = items.reduce((s, i) => s + i.n, 0);
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <Link href={hrefOf(i.key)} className="group block rounded-md p-1 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring" data-testid={`bar-${i.label}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{i.label}{i.extra && <span className="text-xs text-muted-foreground"> · {i.extra}</span>}</span>
              <span className="shrink-0 tabular-nums"><strong>{fmtInt(i.n)}</strong> <span className="text-xs text-muted-foreground">({total ? Math.round((i.n / total) * 100) : 0} %)</span></span>
            </div>
            <div className="h-2.5 rounded-full bg-muted" aria-hidden><div className="h-full rounded-full" style={{ width: `${(i.n / max) * 100}%`, backgroundColor: i.color }} /></div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

type SortKey = "name" | "leads" | "appts_planned" | "won" | "lost" | "conversion" | "won_value";
function UsersTable({ rows }: { rows: UserRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "won", dir: -1 });
  const data = useMemo(() => rows.map((r) => ({ ...r, conversion: conversionRate(r.won, r.lost) ?? -1 })), [rows]);
  const sorted = [...data].sort((a, b) => (sort.key === "name" ? a.name.localeCompare(b.name) * sort.dir : ((a[sort.key] as number) - (b[sort.key] as number)) * sort.dir));
  const head = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground max-md:hidden">
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === -1 ? 1 : -1 }))}>{label}{sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button>
    </th>
  );
  return (
    <table className="w-full text-sm max-md:block" data-testid="users-table">
      <thead className="border-b max-md:hidden"><tr>{head("name", "Utilisateur")}{head("leads", "Leads")}{head("appts_planned", "RDV (réalisés)")}{head("won", "Gagnés")}{head("lost", "Perdus")}{head("conversion", "Conversion")}{head("won_value", "Valeur gagnée")}</tr></thead>
      <tbody className="max-md:block">
        {sorted.map((r) => (
          <tr key={r.user_id ?? "none"} className="border-b last:border-0 max-md:mb-2 max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:rounded-lg max-md:border max-md:p-3" data-testid={`user-${r.name}`}>
            <td className="p-2 font-medium max-md:col-span-2 max-md:p-0">{r.name}</td>
            <td className="p-2 tabular-nums max-md:p-0"><span className="md:hidden text-muted-foreground">Leads : </span>{r.leads}</td>
            <td className="p-2 tabular-nums max-md:p-0"><span className="md:hidden text-muted-foreground">RDV : </span>{r.appts_planned} ({r.appts_done})</td>
            <td className="p-2 tabular-nums max-md:p-0"><span className="md:hidden text-muted-foreground">Gagnés : </span>{r.won}</td>
            <td className="p-2 tabular-nums max-md:p-0"><span className="md:hidden text-muted-foreground">Perdus : </span>{r.lost}</td>
            <td className="p-2 tabular-nums max-md:p-0"><span className="md:hidden text-muted-foreground">Conversion : </span>{fmtPercent(r.conversion < 0 ? null : r.conversion)}</td>
            <td className="p-2 tabular-nums max-md:p-0"><span className="md:hidden text-muted-foreground">Valeur : </span>{fmtEuro(r.won_value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DashboardView({ sources, members, canAll }: { sources: { id: string; name: string }[]; members: { id: string; name: string }[]; canAll: boolean }) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState("");
  const [user, setUser] = useState("");
  // Période résolue côté client (mêmes règles que le serveur) : message clair au-delà de 366 jours, jamais d'appel inutile.
  const { period, periodError } = useMemo(() => {
    if (preset === "custom" && (!from || !to)) return { period: null, periodError: null };
    try {
      return { period: resolvePeriod({ preset, from, to }), periodError: null };
    } catch (e) {
      return { period: null, periodError: e instanceof PeriodError ? e.message : "Période invalide." };
    }
  }, [preset, from, to]);
  const ready = !!period;
  const params = useMemo<DashParams>(() => ({ preset, ...(preset === "custom" ? { from, to } : {}), source: source || null, user: canAll && user ? user : null }), [preset, from, to, source, user, canAll]);

  const kpi = useBlock("kpi", params, dashKpiAction, ready);
  const status = useBlock<{ rows: StatusRow[] }>("status", params, dashStatusAction, ready);
  const time = useBlock<{ rows: TimeRow[]; bucket: "day" | "week" }>("time", params, dashTimeAction, ready);
  const src = useBlock<{ rows: SourceRow[] }>("source", params, dashSourceAction, ready);
  const users = useBlock<{ rows: UserRow[] }>("users", params, dashUsersAction, ready && canAll);

  const sourceHref = (id: string) => {
    const q = new URLSearchParams({ view: "table" });
    if (period) { q.set("from", period.fromDay); q.set("to", shiftDay(period.toDay, -1)); }
    q.set("sources", id);
    if (canAll && user) q.set("assigned", user);
    return `/leads?${q.toString()}`;
  };
  const k = kpi.data;
  const empty = !!k && k.current.created === 0 && k.current.won + k.current.lost === 0;
  // Les liens reprennent période (créés dans la période), source et utilisateur : le nombre affiché = le nombre de lignes de /leads.
  const leadsHref = (extra: string) => {
    const q = new URLSearchParams({ view: "table" });
    if (period) { q.set("from", period.fromDay); q.set("to", shiftDay(period.toDay, -1)); }
    if (source) q.set("sources", source);
    if (canAll && user) q.set("assigned", user);
    return `/leads?${q.toString()}${extra}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Période" className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}
              className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition-colors hover:border-muted-foreground/60", preset === p.id && "border-accent bg-accent-soft text-link")}>{p.label}</button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="Début de période" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <span className="text-sm text-muted-foreground">au</span>
            <Input type="date" aria-label="Fin de période" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        )}
        <Select aria-label="Filtrer par source" value={source} onChange={(e) => setSource(e.target.value)} className="w-44"><option value="">Toutes les sources</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        {canAll && <Select aria-label="Filtrer par utilisateur" value={user} onChange={(e) => setUser(e.target.value)} className="w-48"><option value="">Toute l&apos;équipe</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
      </div>
      {preset === "custom" && !ready && <p role={periodError ? "alert" : undefined} className={cn("text-sm", periodError ? "text-destructive-text" : "text-muted-foreground")}>{periodError ?? "Choisissez une date de début et une date de fin (366 jours maximum)."}</p>}

      <section aria-label="Indicateurs clés" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpi.isLoading ? [0, 1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="h-4 w-20" /><Skeleton className="mt-3 h-8 w-24" /></Card>)
          : kpi.isError ? <div role="alert" className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm xl:col-span-4"><span>Impossible de charger les indicateurs.</span><Button size="sm" variant="outline" onClick={() => kpi.refetch()}>Réessayer</Button></div>
          : k && (() => {
            const c = k.current, p = k.previous;
            const conv = conversionRate(c.won, c.lost), prevConv = conversionRate(p.won, p.lost);
            const pts = deltaPoints(conv, prevConv);
            return (
              <>
                <Kpi testid="kpi-created" label="Leads créés" value={fmtInt(c.created)}><DeltaBadge d={delta(c.created, p.created)} /></Kpi>
                <Kpi testid="kpi-conversion" label="Taux de conversion" value={fmtPercent(conv)} hint={`${c.won} gagné(s) / ${c.won + c.lost} clôturé(s)`}>
                  {pts !== null && <span className={cn("text-xs font-medium", pts > 0 ? "text-success-text" : pts < 0 ? "text-destructive-text" : "text-muted-foreground")}>{pts > 0 ? "+" : ""}{pts} pt <span className="font-normal text-muted-foreground">vs période préc.</span></span>}
                </Kpi>
                <Kpi testid="kpi-appts" label="Rendez-vous" value={fmtInt(c.appts_planned)} hint={`${c.appts_done} réalisé(s)`}><DeltaBadge d={delta(c.appts_planned, p.appts_planned)} /></Kpi>
                <Kpi testid="kpi-value" label="Valeur gagnée" value={fmtEuro(c.won_value)} hint={`${c.won} lead(s) gagné(s)`}><DeltaBadge d={delta(c.won_value, p.won_value)} /></Kpi>
              </>
            );
          })()}
      </section>

      {empty ? (
        <EmptyState icon={BarChart3} title="Pas encore de leads sur la période" description="Créez ou importez des leads pour alimenter le tableau de bord."
          action={<div className="flex gap-2"><Button asChild><Link href="/leads">Créer un lead</Link></Button><Button asChild variant="outline"><Link href="/import">Importer un CSV</Link></Button></div>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Block title="Leads par statut" q={status} empty={status.data ? status.data.rows.every((r) => r.n === 0) : false}>
            <Bars items={(status.data?.rows ?? []).map((r) => ({ key: r.status_id, label: r.name, n: r.n, color: r.color, extra: KIND_LABEL[r.kind] || undefined }))} hrefOf={(id) => leadsHref(`&statuses=${id}`)} />
          </Block>
          <Block title="Évolution" q={time} empty={time.data ? time.data.rows.every((r) => r.created === 0 && r.won === 0) : false}>
            {time.data && <LineChart rows={time.data.rows} bucket={time.data.bucket} />}
          </Block>
          <Block title="Répartition par source" q={src} empty={src.data ? src.data.rows.length === 0 : false}>
            <Bars items={(src.data?.rows ?? []).map((r) => ({ key: r.source_id ?? "none", label: r.name, n: r.n, color: "var(--accent)", extra: r.won ? `${r.won} gagné(s)` : undefined }))} hrefOf={(id) => sourceHref(id)} />
          </Block>
          {canAll && (
            <Block title="Performance par utilisateur" q={users} empty={users.data ? users.data.rows.length === 0 : false}>
              {users.data && <UsersTable rows={users.data.rows} />}
            </Block>
          )}
        </div>
      )}
    </div>
  );
}
