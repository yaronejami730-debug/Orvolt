import { Logo } from "@/components/marketing/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { NOINDEX_METADATA } from "@/lib/seo";

// Connexion, inscription, mot de passe : aucune valeur de référencement, hors index.
export const metadata = NOINDEX_METADATA;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <Logo size="lg" className="mb-8" priority />
      <main className="w-full max-w-xl">{children}</main>
    </div>
  );
}
