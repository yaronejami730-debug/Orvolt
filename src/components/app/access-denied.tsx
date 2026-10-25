import { ShieldOff } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export function AccessDenied() {
  return (
    <EmptyState
      icon={ShieldOff}
      title="Accès refusé"
      description="Vous n'avez pas les permissions nécessaires pour consulter cette page."
    />
  );
}
