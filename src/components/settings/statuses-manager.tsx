"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, ListChecks, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createStatusAction, deleteStatusAction, reorderStatusesAction } from "@/app/(app)/settings/statuses/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PALETTE } from "@/lib/colors";
import { StatusPanel } from "./status-panel";
import { KIND_LABEL, type ActionRow, type MemberOpt, type RoleOpt, type StatusRow, type TransitionRow } from "./workflow-types";

interface Props {
  statuses: StatusRow[];
  transitions: TransitionRow[];
  actions: ActionRow[];
  roles: RoleOpt[];
  members: MemberOpt[];
  canManage: boolean;
  leadCounts?: Record<string, number>;
  emptyAction?: React.ReactNode;
}

function Row({ s, index, total, canManage, onOpen, onMove, onDelete }: {
  s: StatusRow; index: number; total: number; canManage: boolean;
  onOpen: () => void; onMove: (d: -1 | 1) => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, disabled: !canManage });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`status-${s.name}`}
      className={`flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 ${isDragging ? "z-10 opacity-80 shadow-md" : ""}`}
    >
      {canManage && (
        <button
          type="button"
          aria-label={`Déplacer ${s.name} (glisser, ou flèches haut/bas au clavier)`}
          className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <button type="button" onClick={onOpen} className="flex min-w-[9rem] flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-md p-1 text-left hover:bg-muted/50">
        <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
        <span className="min-w-0 break-words font-medium">{s.name}</span>
        {s.is_initial && <Badge tone="accent">Initial</Badge>}
        <Badge tone={s.kind === "won" ? "success" : s.kind === "lost" ? "destructive" : "neutral"}>{KIND_LABEL[s.kind]}</Badge>
      </button>
      {canManage && (
        <div className="flex shrink-0 items-center max-sm:ml-auto">
          <Button size="icon" variant="ghost" aria-label={`Monter ${s.name}`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label={`Descendre ${s.name}`} disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label={`Supprimer ${s.name}`} onClick={onDelete}><Trash2 className="size-4" /></Button>
        </div>
      )}
    </li>
  );
}

export function StatusesManager({ statuses, transitions, actions, roles, members, canManage, leadCounts = {}, emptyAction }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(statuses);
  // Cause racine du test instable : un router.refresh() du 1er déplacement écrasait l'état optimiste du 2e.
  // On ignore les données serveur tant qu'une écriture est en cours.
  const inflight = useRef(0);
  const [saving, setSaving] = useState(0); // écritures d'ordre en cours (exposé : data-saving)
  useEffect(() => { if (inflight.current === 0) setItems(statuses); }, [statuses]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<StatusRow | null>(null);
  const [replacement, setReplacement] = useState("");
  const [pending, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function persist(next: StatusRow[]) {
    const previous = items;
    setItems(next);
    inflight.current++;
    setSaving((n) => n + 1);
    start(async () => {
      try {
        const res = await reorderStatusesAction({ ids: next.map((s) => s.id) });
        if (!res.ok) {
          setItems(previous);
          toast.error(res.error ?? "Réordonnancement impossible.");
        }
      } finally {
        inflight.current--;
        setSaving((n) => n - 1);
      }
      router.refresh();
    });
  }
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((s) => s.id === e.active.id);
    const to = items.findIndex((s) => s.id === e.over!.id);
    persist(arrayMove(items, from, to));
  }
  const open = items.find((s) => s.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}><Plus className="size-4" /> Ajouter un statut</Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState icon={ListChecks} title="Aucun statut" description="Appliquez un template métier ou créez votre premier statut." action={emptyAction} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2" aria-busy={saving > 0} data-saving={saving > 0 ? "true" : "false"}>
              {items.map((s, i) => (
                <Row
                  key={s.id}
                  s={s}
                  index={i}
                  total={items.length}
                  canManage={canManage}
                  onOpen={() => setOpenId(s.id)}
                  onMove={(d) => persist(arrayMove(items, i, i + d))}
                  onDelete={() => { setToDelete(s); setReplacement(""); }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {open && canManage && (
        <StatusPanel
          key={open.id}
          status={open}
          statuses={items}
          transitions={transitions}
          actions={actions}
          roles={roles}
          members={members}
          onClose={() => setOpenId(null)}
          onSaved={() => router.refresh()}
        />
      )}
      {open && !canManage && (
        <Dialog open onOpenChange={() => setOpenId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{open.name}</DialogTitle>
              <DialogDescription>Lecture seule : vous n&apos;avez pas la permission de modifier les statuts.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
      <CreateDialog open={creating} onOpenChange={setCreating} onCreated={() => router.refresh()} />
      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer « {toDelete?.name} » ?</DialogTitle>
            <DialogDescription>Ses transitions et actions automatiques seront supprimées. Cette action est irréversible.</DialogDescription>
          </DialogHeader>
          {toDelete && (leadCounts[toDelete.id] ?? 0) > 0 && (
            <div className="space-y-2">
              <Label htmlFor="replacement">{leadCounts[toDelete.id]} lead(s) utilisent ce statut : choisissez un statut de remplacement</Label>
              <Select id="replacement" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                <option value="">Choisir…</option>
                {items.filter((x) => x.id !== toDelete.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setToDelete(null)}>Annuler</Button>
            <Button
              variant="destructive"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteStatusAction({ id: toDelete!.id, replacementId: replacement || null });
                  if (res.ok) { toast.success("Statut supprimé."); setToDelete(null); router.refresh(); } else toast.error(res.error);
                })
              }
            >
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[8]!.value);
  const [kind, setKind] = useState<"normal" | "won" | "lost">("normal");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un statut</DialogTitle>
          <DialogDescription>Le statut sera ajouté à la fin du pipeline.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createStatusAction({ name, color, kind });
              if (res.ok) {
                toast.success("Statut créé.");
                setName(""); setFe({}); onOpenChange(false); onCreated();
              } else {
                setFe(res.fieldErrors ?? {});
                if (!res.fieldErrors) toast.error(res.error);
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-status-name">Nom</Label>
            <Input id="new-status-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={fe.name ? true : undefined} />
            <FieldError id="new-status-name-error" message={fe.name} />
          </div>
          <div className="space-y-2">
            <Label>Couleur</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            {(["normal", "won", "lost"] as const).map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="new-kind" checked={kind === k} onChange={() => setKind(k)} className="accent-[var(--accent)]" />
                {KIND_LABEL[k]}
              </label>
            ))}
          </fieldset>
          <Button type="submit" className="w-full" loading={pending}>Créer le statut</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
