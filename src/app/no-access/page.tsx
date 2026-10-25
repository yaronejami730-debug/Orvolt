import { ShieldOff } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
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
