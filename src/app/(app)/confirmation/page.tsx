import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { ConfirmationList, type ConfirmationRow, type ConfirmerOption } from "@/components/confirmation/confirmation-list";
import { PageHeader } from "@/components/ui/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Confirmation" };
export const dynamic = "force-dynamic";

const COLS = "id, status, starts_at, ends_at, wish_from, wish_to, duration_min, assigned_to, confirmer_id, location_address, notes, distance_status, distance_km, lead:leads(id, first_name, last_name, company, phone, city)";

export default async function ConfirmationPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const s = await requireSession();
  if (!sessionCan(s, "dispatch.manage")) return <AccessDenied />;
  const done = (await searchParams).vue === "confirmes";
  const supabase = await createClient();

  // Un confirmateur voit sa file (et les RDV sans confirmateur) ; l'administrateur voit toute l'organisation.
  let q = supabase.from("appointments").select(COLS).eq("org_id", s.org.id).eq("is_simulation", false);
  if (!s.isAdmin) q = q.or(`confirmer_id.eq.${s.user.id},confirmer_id.is.null`);
  q = done
    ? q.eq("status", "confirmed").gte("updated_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("updated_at", { ascending: false })
    : q.eq("status", "planned").order("starts_at", { ascending: true, nullsFirst: false }).order("wish_from", { ascending: true, nullsFirst: false });
  const { data: raw } = await q.limit(300);

  // Confirmateurs de l'organisation (menu de réattribution, administrateur uniquement).
  let confirmers: ConfirmerOption[] = [];
  const admin = createAdminClient();
  const { data: mem } = await admin.from("memberships").select("user_id, role:roles!inner(is_admin, system_key, permissions)").eq("org_id", s.org.id).eq("status", "active");
  const cIds = (mem ?? []).filter((m) => { const r = m.role as unknown as { is_admin: boolean; system_key: string | null; permissions: string[] }; return !r.is_admin && !r.system_key && r.permissions.includes("dispatch.manage"); }).map((m) => m.user_id as string);
  const ids = [...new Set([...cIds, ...(raw ?? []).flatMap((r) => [r.assigned_to, r.confirmer_id]).filter(Boolean) as string[]])];
  const { data: profs } = ids.length ? await admin.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const name = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name ?? p.email ?? "—") as string]));
  if (s.isAdmin) confirmers = cIds.map((id) => ({ id, name: name.get(id) ?? "—" }));

  const rows: ConfirmationRow[] = (raw ?? []).map((r) => {
    const lead = r.lead as unknown as { id: string; first_name: string | null; last_name: string | null; company: string | null; phone: string | null; city: string | null } | null;
    return {
      id: r.id, leadId: lead?.id ?? null,
      leadName: [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || lead?.company || "Lead",
      company: lead?.first_name || lead?.last_name ? lead?.company ?? null : null,
      phone: lead?.phone ?? null, address: r.location_address ?? lead?.city ?? null,
      startsAt: r.starts_at, endsAt: r.ends_at, wishFrom: r.wish_from, wishTo: r.wish_to, durationMin: r.duration_min,
      commercial: r.assigned_to ? name.get(r.assigned_to) ?? "—" : null,
      confirmerId: r.confirmer_id, confirmerName: r.confirmer_id ? name.get(r.confirmer_id) ?? "—" : null,
      distanceStatus: r.distance_status, distanceKm: r.distance_km, notes: r.notes,
    };
  });

  // À confirmer : ordre chronologique (heure fixée ou début de la fenêtre de souhait).
  if (!done) rows.sort((a, b) => (a.startsAt ?? a.wishFrom ?? "9999").localeCompare(b.startsAt ?? b.wishFrom ?? "9999"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Confirmation"
        description={s.isAdmin
          ? "Les rendez-vous pris sont attribués automatiquement aux confirmateurs. Vous pouvez en réattribuer un à la main."
          : "Les rendez-vous pris arrivent ici automatiquement. Confirmez-les un par un avec le client."}
      />
      <ConfirmationList rows={rows} confirmers={confirmers} isAdmin={s.isAdmin} done={done} meId={s.user.id} />
    </div>
  );
}
