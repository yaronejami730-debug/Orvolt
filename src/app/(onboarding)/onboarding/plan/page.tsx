import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingPlans } from "@/components/onboarding/onboarding-plans";
import { intentFromAnswers, parsePlanIntent } from "@/lib/funnel/intent";
import { OnboardingSteps } from "@/components/onboarding/steps";
import { Button } from "@/components/ui/button";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { afterOnboardingPath, planRequired, simulateBilling } from "@/lib/onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Votre formule" };
export const dynamic = "force-dynamic";

export default async function PlanStepPage({ searchParams }: { searchParams: Promise<{ checkout?: string; plan?: string; interval?: string }> }) {
  const s = await requireSession();
  if (!s.isAdmin || s.org.parent_org_id) redirect("/dashboard");
  if (!s.org.org_type) redirect("/onboarding/activite");
  const { data } = await createAdminClient().from("organizations").select("onboarding").eq("id", s.org.id).single();
  const next = afterOnboardingPath(data?.onboarding as Record<string, unknown> | null);
  const sp = await searchParams;
  const checkout = sp.checkout;
  // Formule présélectionnée : retour d'annulation (?plan=) en priorité, sinon l'intention enregistrée à l'inscription (lien du site).
  const saved = intentFromAnswers(data?.onboarding);
  const fromUrl = parsePlanIntent(sp.plan, sp.interval);
  const intent = fromUrl.plan ? fromUrl : saved;

  // Formule déjà souscrite (essai Stripe démarré) : l'onboarding est terminé.
  if (s.org.plan !== "trial") redirect(next);

  return (
    <div className="space-y-6">
      <OnboardingSteps current={checkout === "success" ? 3 : 2} />
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Choisissez votre formule</h1>
        <p className="text-muted-foreground" data-testid="trial-promise">Vous démarrez avec <strong>{TRIAL_DAYS} jours d&apos;essai gratuit</strong> : vous ne payez rien aujourd&apos;hui. Votre carte sert uniquement à lancer l&apos;essai ; vous annulez en un clic avant la fin, sans frais. Vous pourrez changer de formule à tout moment.</p>
      </div>
      {planRequired() || simulateBilling() ? (
        <>
          {simulateBilling() && <p role="note" className="max-w-2xl rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="simulation-banner"><strong>Simulation.</strong> La clé Stripe n&apos;est pas configurée : le paiement ci-dessous est simulé (aucune carte, aucun prélèvement). Avec Stripe, ce même écran ouvre le vrai paiement sécurisé.</p>}
          <OnboardingPlans initialPlan={intent.plan} initialInterval={intent.interval} waiting={checkout === "success"} cancelled={checkout === "cancel"} simulated={simulateBilling()} next={next} />
        </>
      ) : (
        <div className="max-w-xl space-y-3 rounded-xl border bg-card p-5" data-testid="plan-dev-skip">
          <p className="text-sm text-muted-foreground">La facturation n&apos;est pas configurée sur ce serveur (clé Stripe absente) : cette étape est ignorée en développement.</p>
          <Button asChild><Link href={next}>Continuer</Link></Button>
        </div>
      )}
    </div>
  );
}
