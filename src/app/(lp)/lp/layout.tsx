import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/marketing/logo";

// Pages d'acquisition : jamais indexées (en plus de l'en-tête X-Robots-Tag, next.config.ts), absentes du sitemap.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** En-tête et pied de page minimaux : le logo (sans lien, pour ne pas faire fuir le visiteur), « Se connecter », les mentions. */
export default function LpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
        <Logo href={null} priority />
        <Link href="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Se connecter</Link>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-5 py-8 text-xs text-muted-foreground sm:px-8">
        <nav aria-label="Informations légales" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
          <Link href="/confidentialite" className="hover:text-foreground">Confidentialité</Link>
          <span>Paiements sécurisés par Stripe</span>
        </nav>
      </footer>
    </div>
  );
}
