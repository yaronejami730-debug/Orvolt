import { ShieldOff } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4">
      <Logo size="lg" href={null} />
      <EmptyState
        icon={ShieldOff}
        title="Aucune organisation active"
        description="Votre accès a été désactivé ou vous n'appartenez à aucune organisation. Contactez votre administrateur."
        action={<form action={logoutAction}><Button type="submit" variant="outline">Se déconnecter</Button></form>}
        className="w-full"
      />
    </main>
  );
}
