import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function LeadNotFound() {
  return (
    <EmptyState icon={SearchX} title="Lead introuvable" description="Ce lead n'existe pas ou vous n'y avez pas accès."
      action={<Button asChild variant="outline"><Link href="/leads">Retour aux leads</Link></Button>} />
  );
}
