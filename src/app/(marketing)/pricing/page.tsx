import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { JsonLd } from "@/components/marketing/json-ld";
import { PRICING_FAQ } from "@/components/marketing/faq-data";
import { FaqSection } from "@/components/marketing/faq-section";
import { PricingSection } from "@/components/marketing/pricing-section";
import { FinalCta } from "@/components/marketing/sections";
import { isSignedIn } from "@/lib/marketing-session";
import { faqSchema, graph, organizationSchema, pageMetadata, softwareSchema } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/pricing");

export default async function PricingPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <Breadcrumbs trail={[{ name: "Tarifs", path: "/pricing" }]} />
      <JsonLd data={graph(organizationSchema(), softwareSchema(), faqSchema(PRICING_FAQ))} />
      <PricingSection page signedIn={signedIn} />
      <FaqSection items={PRICING_FAQ} />
      <FinalCta signedIn={signedIn} />
    </>
  );
}
