import Link from "next/link";
import { Logo } from "./logo";

const COLS = [
  { title: "Produit", links: [{ href: "/#fonctionnalites", label: "Fonctionnalités" }, { href: "/#comment-ca-marche", label: "Comment ça marche" }, { href: "/pricing", label: "Tarifs" }, { href: "/#faq", label: "FAQ" }] },
  { title: "Compte", links: [{ href: "/signup", label: "Essai gratuit" }, { href: "/login", label: "Connexion" }] },
  { title: "Légal", links: [{ href: "/mentions-legales", label: "Mentions légales" }, { href: "/confidentialite", label: "Confidentialité" }, { href: "/cgv", label: "CGV" }] },
];

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Le CRM des équipes de terrain : suivez chaque lead de l&apos;appel à la signature.</p>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-sm font-medium">{c.title}</h2>
            <ul className="mt-4 space-y-3">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} LeadForge. Tous droits réservés.</p>
          <p>Fait pour les équipes de terrain.</p>
        </div>
      </div>
    </footer>
  );
}
