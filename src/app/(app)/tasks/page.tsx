import type { Metadata } from "next";
import { CheckSquare } from "lucide-react";
import { TasksList, type TaskItem } from "@/components/app/tasks-list";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { leadName } from "@/lib/leads/types";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Mes tâches" };

export default async function TasksPage() {
  const s = await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, due_at, done, lead_id, lead:leads(first_name, last_name, company)")
    .eq("org_id", s.org.id)
    .eq("assigned_to", s.user.id)
    .order("done")
    .order("due_at", { nullsFirst: false })
    .limit(200);
  const tasks: TaskItem[] = (data ?? []).map((t) => {
    const l = t.lead as unknown as { first_name: string; last_name: string; company: string | null } | null;
    return { id: t.id, title: t.title, due_at: t.due_at, done: t.done, lead_id: t.lead_id, lead_name: l ? leadName(l) : null };
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Mes tâches" description="Les tâches qui vous sont assignées." />
      {tasks.length === 0 ? <EmptyState icon={CheckSquare} title="Aucune tâche" description="Les tâches créées par vos statuts ou assignées par l'équipe apparaîtront ici." /> : <TasksList tasks={tasks} />}
    </div>
  );
}
