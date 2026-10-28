import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/contact-form";
import { Logo } from "@/components/marketing/logo";
import { hasFeature } from "@/lib/billing/feature-guard";
import { getSession } from "@/lib/session";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Être recontacté",
  description: `Laissez-nous vos coordonnées : un conseiller ${SITE_NAME} vous recontacte.`,
  alternates: { canonical: "/contact" },
  robots: { index: false, follow: false },
};

export default async function ContactPage() {
  const session = await getSession().catch(() => null);
  const priority = session ? await hasFeature(session.org.id, "priority_support") : false;
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center px-5 py-14">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-gradient-to-b from-accent-soft to-transparent" />

      <div className="flex flex-col items-center text-center">
        <Logo size="lg" priority />
        <h1 className="mt-10 max-w-xl text-balance text-3xl font-bold tracking-[-0.045em] sm:text-4xl">Parlons de votre activité</h1>
        <p className="mt-3 max-w-md text-muted-foreground">Laissez-nous vos coordonnées : un conseiller vous recontacte pour vous présenter {SITE_NAME}.</p>
      </div>

      <div className="mt-10 w-full max-w-xl rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
        {priority && <p className="mb-5 rounded-lg border bg-accent-soft px-4 py-3 text-sm" data-testid="contact-priority">Plan Premium : votre demande est marquée prioritaire et traitée en premier.</p>}
        <ContactForm />
      </div>
    </div>
  );
}
