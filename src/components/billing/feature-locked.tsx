import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FEATURE_LABELS, minPlanFor, type PlanFeature } from "@/lib/billing/plans";

/** Écran « Disponible avec le plan X » : remplace une page dont le plan en cours ne donne pas accès. */
export function FeatureLocked({ feature, canUpgrade = false }: { feature: PlanFeature; canUpgrade?: boolean }) {
  const plan = minPlanFor(feature);
  return (
    <EmptyState
      icon={Lock}
      title={`Disponible avec le plan ${plan.name}`}
      description={`${FEATURE_LABELS[feature]} est inclus à partir du plan ${plan.name}.${canUpgrade ? "" : " Demandez à un administrateur de changer de formule."}`}
      action={canUpgrade ? <Button asChild size="sm"><Link href="/settings/billing">Voir les formules</Link></Button> : undefined}
    />
  );
}
