import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const TUNNEL_STEPS = ["Votre compte", "Votre formule", "Paiement sécurisé"] as const;
const STEPS = TUNNEL_STEPS;

/** Fil d'étapes du tunnel (1 = compte, 2 = formule, 3 = paiement chez Stripe) : « Étape X sur 3 » toujours visible. */
export function OnboardingSteps({ current, className }: { current: 1 | 2 | 3; className?: string }) {
  return (
    <div className="space-y-2">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="step-counter">Étape {current} sur {STEPS.length}</p>
    <ol className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)} aria-label="Étapes" data-testid="onboarding-steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={n === current ? "step" : undefined}>
            <span className={cn("grid size-6 place-items-center rounded-full border text-xs font-semibold", n === current && "border-accent bg-accent text-accent-foreground", done && "border-accent text-accent")}>{done ? <Check className="size-3.5" aria-hidden /> : n}</span>
            <span className={cn(n === current ? "font-medium" : "text-muted-foreground")}>{label}</span>
            {n < STEPS.length && <span aria-hidden className="mx-1 h-px w-8 bg-border" />}
          </li>
        );
      })}
    </ol>
    </div>
  );
}
