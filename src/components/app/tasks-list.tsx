"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toggleTaskAction } from "@/app/(app)/leads/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { ago, dateFr } from "@/components/leads/format";

export interface TaskItem { id: string; title: string; due_at: string | null; done: boolean; lead_id: string | null; lead_name: string | null }

export function TasksList({ tasks }: { tasks: TaskItem[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <ul className="space-y-2" data-testid="tasks">
      {tasks.map((t) => {
        const late = !t.done && t.due_at && new Date(t.due_at) < new Date();
        return (
          <li key={t.id} data-testid={`task-${t.title}`} className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <Checkbox aria-label={`Terminer ${t.title}`} checked={t.done} onCheckedChange={(v) => start(async () => {
              const r = await toggleTaskAction({ id: t.id, done: v === true });
              if (!r.ok) toast.error(r.error);
              router.refresh();
            })} />
            <div className="min-w-0 flex-1">
              <p className={t.done ? "text-muted-foreground line-through" : "font-medium"}>{t.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.lead_id && <Link href={`/leads/${t.lead_id}`} className="hover:underline">{t.lead_name}</Link>}
                {t.due_at && <span className={late ? "ml-2 font-medium text-destructive-text" : "ml-2"} title={dateFr(t.due_at)}>échéance {ago(t.due_at)}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
