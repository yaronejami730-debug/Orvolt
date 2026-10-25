import { AlertTriangle, ExternalLink, Navigation, Route } from "lucide-react";
import { ReportIssue } from "@/components/agenda/report-issue";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { googleMapsRoute, wazeTo } from "@/lib/dispatch/links";
import { fmtMin, localDay, localMinutes } from "@/lib/dispatch/time";
import { DEFAULT_TRAFFIC, TRAFFIC_WARNING, trafficMinutes } from "@/lib/dispatch/traffic";
import { leadName } from "@/lib/leads/types";
import { resolveMatrix } from "@/lib/routing/service";
import { createClient } from "@/lib/supabase/server";

const dayLabel = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

/** Tournée du commercial (aujourd'hui + 2 jours) : durées et distances routières réelles, itinéraire Google Maps / Waze. */
export async function MyTour({ orgId, userId }: { orgId: string; userId: string }) {
  const supabase = await createClient();
  const from = new Date(Date.now() - 6 * 3_600_000);
  const { data } = await supabase.from("appointments")
    .select("id, starts_at, ends_at, location_address, lat, lng, issue_message, lead:leads(first_name, last_name, company)")
    .eq("org_id", orgId).eq("assigned_to", userId).eq("dispatch_status", "assigned").neq("status", "cancelled")
    .gte("starts_at", from.toISOString()).lt("starts_at", new Date(Date.now() + 3 * 86_400_000).toISOString()).order("starts_at").limit(30);
  const { data: zone } = await supabase.from("sales_zones").select("base_lat, base_lng, travel_margin_min").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  const rows = (data ?? []) as unknown as { id: string; starts_at: string; ends_at: string; location_address: string | null; lat: number | null; lng: number | null; issue_message: string | null; lead: { first_name: string; last_name: string; company: string | null } | null }[];
  if (rows.length === 0 || !zone) return null;
  const pts = [{ lat: zone.base_lat, lng: zone.base_lng }, ...rows.filter((r) => r.lat !== null && r.lng !== null).map((r) => ({ lat: r.lat!, lng: r.lng! }))];
  const { matrix, provider } = await resolveMatrix(pts);
  const index = new Map<string, number>();
  rows.filter((r) => r.lat !== null).forEach((r, i) => index.set(r.id, i + 1));
  const days = [...new Set(rows.map((r) => localDay(new Date(r.starts_at))))];
  return (
    <Card data-testid="my-tour">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Route className="size-4" />Ma tournée</CardTitle>
        <p className="text-xs text-muted-foreground">{provider.label}. Circulation : estimation selon l&apos;heure.</p>
        <p className="flex items-start gap-1.5 text-xs font-medium text-warning-text" data-testid="traffic-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{TRAFFIC_WARNING}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {days.map((d) => {
          const list = rows.filter((r) => localDay(new Date(r.starts_at)) === d);
          const pos = list.filter((r) => r.lat !== null).map((r) => ({ lat: r.lat!, lng: r.lng! }));
          const g = googleMapsRoute({ lat: zone.base_lat, lng: zone.base_lng }, pos);
          let prev = 0;
          return (
            <div key={d} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold capitalize">{dayLabel(d)}</h3>
                {g && <span className="flex gap-3 text-xs">
                  <a href={g} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link hover:underline" data-testid="open-route"><ExternalLink className="size-3" />Ouvrir l&apos;itinéraire</a>
                  <a href={wazeTo(pos[0]!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link hover:underline"><Navigation className="size-3" />Waze</a>
                </span>}
              </div>
              <ol className="space-y-2">
                {list.map((r) => {
                  const i = index.get(r.id);
                  let leg: string | null = null;
                  if (i !== undefined) {
                    const base = matrix.durations[prev]![i]!;
                    const km = matrix.distances[prev]![i]! / 1000;
                    const withTraffic = trafficMinutes(base, d, Math.max(0, localMinutes(new Date(r.starts_at)) - Math.round(base / 60)), DEFAULT_TRAFFIC);
                    leg = `${Math.round(base / 60)} min · ${km.toFixed(1)} km${withTraffic > Math.round(base / 60) ? ` (≈ ${withTraffic} min avec circulation)` : ""}`;
                    prev = i;
                  }
                  return (
                    <li key={r.id} className="rounded-lg border p-3 text-sm" data-testid="tour-stop">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span><span className="tabular-nums font-medium">{fmtMin(localMinutes(new Date(r.starts_at)))}–{fmtMin(localMinutes(new Date(r.ends_at)))}</span> {r.lead ? leadName(r.lead) : "Lead"}</span>
                        <ReportIssue id={r.id} label={r.lead ? leadName(r.lead) : "RDV"} address={r.location_address} />
                      </div>
                      <p className="text-xs text-muted-foreground">{r.location_address ?? "Adresse non renseignée"}</p>
                      {leg && <p className="text-xs text-muted-foreground">Trajet : {leg}</p>}
                      {r.issue_message && <Badge tone="warning" className="mt-1">Problème signalé</Badge>}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
