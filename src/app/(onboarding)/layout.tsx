import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/session";

/** Onboarding : aucune navigation vers l'application (ni tableau de bord, ni leads) tant qu'il n'est pas terminé. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Logo href={null} />
        <form action={logoutAction} className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{s.user.email}</span>
          <Button type="submit" variant="ghost" size="sm">Se déconnecter</Button>
        </form>
      </header>
      <main id="contenu" className="mx-auto max-w-5xl px-5 pb-20 pt-4">{children}</main>
    </div>
  );
}
