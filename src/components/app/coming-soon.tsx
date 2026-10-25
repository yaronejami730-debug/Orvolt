import { Hourglass } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-8">
      <PageHeader title={title} description={description} />
      <EmptyState icon={Hourglass} title="Bientôt disponible" description="Cette section arrive dans une prochaine version." />
    </div>
  );
}
