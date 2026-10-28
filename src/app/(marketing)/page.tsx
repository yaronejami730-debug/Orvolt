import type { Metadata } from "next";
import { FaqSection } from "@/components/marketing/faq-section";
import { FAQ } from "@/components/marketing/faq-data";
import { FeatureDemos } from "@/components/marketing/feature-demos";
import { Hero } from "@/components/marketing/hero";
import { JsonLd } from "@/components/marketing/json-ld";
import { RelatedLinks } from "@/components/marketing/page-sections";
import { PricingSection } from "@/components/marketing/pricing-section";
import { CtaBand, Features, FinalCta, HowItWorks, Statement, Trades } from "@/components/marketing/sections";
import { StickyTrialBar } from "@/components/marketing/sticky-trial-bar";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { isSignedIn } from "@/lib/marketing-session";
import { faqSchema, graph, organizationSchema, pageMetadata, softwareSchema, websiteSchema } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/");

export default async function LandingPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <JsonLd data={graph(organizationSchema(), websiteSchema(), softwareSchema(), faqSchema(FAQ))} />
      <Hero signedIn={signedIn} />
      <Statement />
      <CtaBand signedIn={signedIn} title="Voyez-le tourner avec vos propres leads." text={`Créez votre espace en quelques minutes et testez ${TRIAL_DAYS} jours avec votre équipe.`} />
      <Trades />
      <Features />
      <FeatureDemos />
      <CtaBand signedIn={signedIn} title="Kanban, rôles, agenda : tout est dans l'essai." text={`Pendant ${TRIAL_DAYS} jours, vous utilisez toutes les fonctionnalités avec votre équipe.`} />
      <HowItWorks />
      <CtaBand signedIn={signedIn} title="Prêt en trois étapes. Lancez la première maintenant." text="Le modèle énergie est déjà en place, vous n'avez qu'à l'adapter." />
      <PricingSection signedIn={signedIn} />
      <RelatedLinks
        links={[
          { href: "/fonctionnalites", label: "Toutes les fonctionnalités", text: "Statuts, rôles, agenda, répartition, import et webhooks." },
          { href: "/solutions/installateurs-energie", label: "CRM pour installateurs d'énergie", text: "Solaire, pompe à chaleur, isolation : le modèle prêt à l'emploi." },
          { href: "/solutions/regies-prospection", label: "CRM pour régies de prospection", text: "Prospecteurs, confirmateurs, commerciaux et régies partenaires." },
          { href: "/pricing", label: "Tarifs", text: "Quatre formules, essai gratuit, paiement sécurisé par Stripe." },
          { href: "/contact", label: "Être recontacté", text: "Laissez vos coordonnées, un conseiller vous rappelle." },
        ]}
      />
      <FaqSection />
      <CtaBand signedIn={signedIn} title="Une question reste ouverte ? Essayez avec votre équipe." />
      <FinalCta signedIn={signedIn} />
      {!signedIn && <StickyTrialBar />}
    </>
  );
}
