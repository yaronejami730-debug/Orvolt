import Link from "next/link";
import { AlertTriangle, Clock, Lock } from "lucide-react";
import type { Entitlement } from "@/lib/billing/entitlement";
import { cn } from "@/lib/utils";

const dateFr = (d: Date) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(d);

/** Bandeau d'état de l'abonnement (essai, paiement échoué, lecture seule, sièges dépassés). Rien pour un abonnement sain. */
/** `partner` : sous-régie. Elle ne gère pas l'abonnement (c'est celui de la régie maître) : pas de lien d'achat, et l'essai de la maître n'est pas affiché. */
export function BillingBanner({ e, canManage, partner = false }: { e: Entitlement; canManage: boolean; partner?: boolean }) {
  let tone: "info" | "warning" | "danger" | null = null;
  let text = "";
  let Icon = Clock;
  if (e.state === "canceled" || e.state === "trial_expired") {
    tone = "danger"; Icon = Lock;
    text = e.state === "trial_expired" ? "Abonnement inactif : lecture seule. Votre essai est terminé." : "Abonnement inactif : lecture seule. Votre abonnement n'est plus actif.";
  } else if (e.state === "past_due") {
    tone = "danger"; Icon = AlertTriangle;
    text = `Le paiement de votre abonnement a échoué. Mettez à jour votre moyen de paiement avant le ${e.graceEndsAt ? dateFr(e.graceEndsAt) : "délai de grâce"}.`;
  } else if (e.seatsExceeded) {
    tone = "warning"; Icon = AlertTriangle;
    text = `Votre plan inclut ${e.seatLimit} utilisateur(s) mais ${e.seatsUsed} sont actifs : désactivez ${e.seatsOver} membre(s) pour pouvoir en ajouter.`;
  } else if (e.state === "trialing") {
    tone = "info";
    const d = e.trialDaysLeft;
    text = d === null ? "Essai gratuit en cours." : `Essai gratuit : ${d} jour${d > 1 ? "s" : ""} restant${d > 1 ? "s" : ""}.`;
  }
  if (!tone || (partner && tone === "info")) return null;
  if (partner) text += " Contactez votre régie maître.";
  const href = e.seatsExceeded && e.state !== "canceled" && e.state !== "trial_expired" && e.state !== "past_due" ? "/settings/members" : "/settings/billing";
  const label = href === "/settings/members" ? "Gérer les membres" : e.state === "trialing" ? "Choisir un plan" : e.state === "past_due" ? "Régler la facturation" : "Réactiver l'abonnement";
  return (
    <div role={tone === "danger" ? "alert" : "status"} data-testid="billing-banner" data-state={e.seatsExceeded && tone === "warning" ? "seats_exceeded" : e.state}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm", tone === "info" && "bg-accent-soft", tone === "warning" && "bg-warning/15", tone === "danger" && "bg-destructive/15")}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      {canManage && !partner && <Link href={href} className="shrink-0 font-medium underline underline-offset-2">{label}</Link>}
    </div>
  );
}
