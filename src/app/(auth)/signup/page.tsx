import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { parsePlanIntent, sanitizeSource } from "@/lib/funnel/intent";
import { sanitizePrefill } from "@/lib/landing/fields";
import { planRequired } from "@/lib/onboarding";

export const metadata: Metadata = { title: "Inscription" };

/**
 * ?email=&firstName=&lastName= : préremplissage venant des pages d'acquisition (/lp/*), assaini et borné.
 * ?plan=&interval= : formule choisie sur les CTA / la page tarifs (réaffichée, puis présélectionnée au paiement). ?src= : source d'acquisition.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const intent = parsePlanIntent(sp.plan, sp.interval);
  return <SignupForm prefill={sanitizePrefill(sp)} plan={intent.plan} interval={intent.interval} source={sanitizeSource(sp.src ?? sp.utm_source)} cardRequired={planRequired()} />;
}
