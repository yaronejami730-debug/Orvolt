import Link from "next/link";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { BillingInterval, PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { TRIAL_HINT, trialHref } from "./trial-cta-href";

type Props = {
  signedIn?: boolean;
  /** Carte de plan d'origine : conservé dans l'URL (?plan=&interval=). */
  plan?: PlanId;
  interval?: BillingInterval;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  /** Micro-texte « 14 jours d'essai · annulation en un clic » : dessous ou à côté. */
  hint?: "below" | "inline" | false;
  label?: string;
  /** Connecté : libellé et cible (par défaut « Ouvrir l'app » vers /dashboard). */
  signedInLabel?: string;
  signedInHref?: string;
  className?: string;
  buttonClassName?: string;
};

/** Bouton d'essai unique du site marketing (pilule noire). Connecté : accès direct à l'app. */
export function TrialCta({ signedIn = false, plan, interval, size = "lg", variant, hint = false, label = "Essayer gratuitement", signedInLabel = "Ouvrir l'app", signedInHref, className, buttonClassName }: Props) {
  const href = trialHref({ plan, interval, signedIn, signedInHref });
  const inline = hint === "inline";
  return (
    <div className={cn("flex gap-x-4 gap-y-2.5", inline ? "flex-col items-center sm:flex-row" : "flex-col items-center", className)}>
      <Button asChild size={size} variant={variant} className={buttonClassName}>
        <Link href={href}>{signedIn ? signedInLabel : label}</Link>
      </Button>
      {hint && !signedIn && <p className="text-sm text-muted-foreground">{TRIAL_HINT}</p>}
    </div>
  );
}
