import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page introuvable", robots: { index: false, follow: true } };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <Logo size="lg" className="mb-4" />
      <p className="text-sm font-medium text-muted-foreground">Erreur 404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="text-sm text-muted-foreground">Cette page n&apos;existe pas ou a été déplacée.</p>
      <Button asChild><Link href="/">Retour à l&apos;accueil</Link></Button>
    </main>
  );
}
