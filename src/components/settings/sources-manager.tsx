"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, Lock, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { archiveSourceAction, deleteSourceAction, saveSourceAction } from "@/app/(app)/settings/sources/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";

export interface SourceRow {
  id: string;
  name: string;
  color: string | null;
  is_default: boolean;
  is_system: boolean;
  archived: boolean;
  leads?: number;
}
const SUGGESTIONS = ["Site web", "Facebook", "Google", "Recommandation", "Téléphone"];

export function SourcesManager({ sources }: { sources: SourceRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string>();
  const [pending, start] = useTransition();

  const add = (n: string) =>
    start(async () => {
      const res = await saveSourceAction({ name: n });
      if (res.ok) { setName(""); setError(undefined); router.refresh(); } else setError(res.fieldErrors?.name ?? res.error);
    });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(ok); router.refresh(); } else toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); add(name); }}>
        <div className="flex gap-2">
          <Input aria-label="Nouvelle source" placeholder="Nom de la source" value={name} onChange={(e) => { setName(e.target.value); setError(undefined); }} aria-invalid={error ? true : undefined} />
          <Button type="submit" loading={pending}><Plus className="size-4" /> Ajouter</Button>
        </div>
        <FieldError id="source-error" message={error} />
      </form>
      {sources.length === 0 ? (
        <EmptyState icon={Users} title="Aucune source" description="Ajoutez les canaux par lesquels arrivent vos leads."
          action={<div className="flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <Button key={s} size="sm" variant="outline" onClick={() => add(s)}>{s}</Button>)}</div>} />
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} data-testid={`source-${s.name}`} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <span className="size-3 shrink-0 rounded-full border" style={{ backgroundColor: s.color ?? "transparent" }} aria-hidden />
              {editId === s.id ? (
                <form className="flex flex-1 flex-col gap-1" onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    const res = await saveSourceAction({ id: s.id, name: editName });
                    if (res.ok) { setEditId(null); router.refresh(); } else setEditError(res.fieldErrors?.name ?? res.error);
                  });
                }}>
                  <div className="flex gap-1">
                    <Input aria-label="Renommer la source" value={editName} onChange={(e) => { setEditName(e.target.value); setEditError(undefined); }} className="h-9" />
                    <Button size="icon" variant="ghost" type="submit" aria-label="Valider"><Check className="size-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Annuler" onClick={() => setEditId(null)}><X className="size-4" /></Button>
                  </div>
                  <FieldError id="source-edit-error" message={editError} />
                </form>
              ) : (
                <>
                  <span className={`min-w-0 flex-1 truncate font-medium ${s.archived ? "text-muted-foreground line-through" : ""}`}>{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground" data-testid="source-count">{s.leads ?? 0} lead{(s.leads ?? 0) > 1 ? "s" : ""}</span>
                  {s.is_system && <Badge><Lock className="mr-1 size-3" aria-hidden />Système</Badge>}
                  {s.is_default && <Badge tone="accent">Par défaut</Badge>}
                  {s.archived && <Badge tone="warning">Archivée</Badge>}
                  {!s.is_system && (
                    <div className="flex shrink-0">
                      <Button size="icon" variant="ghost" aria-label={`Renommer ${s.name}`} onClick={() => { setEditId(s.id); setEditName(s.name); setEditError(undefined); }}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`${s.archived ? "Désarchiver" : "Archiver"} ${s.name}`} onClick={() => run(() => archiveSourceAction({ id: s.id, archived: !s.archived }), s.archived ? "Source restaurée." : "Source archivée.")}>
                        {s.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Supprimer ${s.name}`} onClick={() => { if (window.confirm(`Supprimer la source « ${s.name} » ? Préférez l'archivage si elle est utilisée.`)) run(() => deleteSourceAction({ id: s.id }), "Source supprimée."); }}><Trash2 className="size-4" /></Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
