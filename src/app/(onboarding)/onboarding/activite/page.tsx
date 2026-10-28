import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActivityForm } from "@/components/onboarding/activity-form";
import { OnboardingSteps } from "@/components/onboarding/steps";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Votre activité" };

/** Première connexion : le gérant dit s'il est installateur ou régie. Une sous-régie n'est pas concernée (créée par sa maître). */
export default async function ActivityPage() {
  const s = await requireSession();
  if (!s.isAdmin || s.org.parent_org_id) redirect("/onboarding");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <OnboardingSteps current={1} />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Parlons de votre activité</h1>
        <p className="text-muted-foreground">Quelques questions pour préparer votre espace. Vous pourrez tout modifier ensuite.</p>
      </div>
      <ActivityForm initialType={s.org.org_type} />
    </div>
  );
}
