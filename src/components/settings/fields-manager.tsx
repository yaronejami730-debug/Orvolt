"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown, ArrowUp, GripVertical, List, Pencil, Plus, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { deleteFieldAction, reorderFieldsAction, saveFieldAction } from "@/app/(app)/settings/fields/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FIELD_TYPE_META, type FieldType } from "./field-types";
import type { RoleOpt } from "./workflow-types";

export interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: { choices?: string[]; multiple?: boolean; min?: number; max?: number };
  required: boolean;
  position: number;
  visible_roles: string[] | null;
  editable_roles: string[] | null;
}



function Row({ f, i, total, roles, onEdit, onMove, onDelete }: { f: FieldRow; i: number; total: number; roles: RoleOpt[]; onEdit: () => void; onMove: (d: -1 | 1) => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: f.id });
  const Icon = FIELD_TYPE_META[f.type].icon;
  const hidden = f.visible_roles !== null && f.visible_roles.length === 0;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-testid={`field-${f.label}`}
      className={cn("flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2", isDragging && "z-10 opacity-80 shadow-md")}>
      <button type="button" aria-label={`Déplacer ${f.label}`} className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{f.label}</span>
        <Badge>{FIELD_TYPE_META[f.type].label}</Badge>
        {f.required && <Badge tone="accent">Obligatoire</Badge>}
        {hidden ? <Badge tone="warning">Masqué</Badge> : f.visible_roles && roles.filter((r) => f.visible_roles!.includes(r.id)).map((r) => <Badge key={r.id}>{r.name}</Badge>)}
      </div>
      <div className="flex shrink-0 items-center">
        <Button size="icon" variant="ghost" aria-label={`Monter ${f.label}`} disabled={i === 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={`Descendre ${f.label}`} disabled={i === total - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={`Modifier ${f.label}`} onClick={onEdit}><Pencil className="size-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={`Supprimer ${f.label}`} onClick={onDelete}><Trash2 className="size-4" /></Button>
      </div>
    </li>
  );
}

export function FieldsManager({ fields, roles }: { fields: FieldRow[]; roles: RoleOpt[] }) {
  const router = useRouter();
  const [items, setItems] = useState(fields);
  const inflight = useRef(0);
  const [saving, setSaving] = useState(0); // ignore les données serveur pendant une écriture (voir statuses-manager)
  useEffect(() => { if (inflight.current === 0) setItems(fields); }, [fields]);
  const [editing, setEditing] = useState<FieldRow | "new" | null>(null);
  const [toDelete, setToDelete] = useState<FieldRow | null>(null);
  const [pending, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function persist(next: FieldRow[]) {
    const previous = items;
    setItems(next);
    inflight.current++;
    setSaving((n) => n + 1);
    start(async () => {
      try {
        const res = await reorderFieldsAction({ ids: next.map((f) => f.id) });
        if (!res.ok) { setItems(previous); toast.error(res.error); }
      } finally {
        inflight.current--;
        setSaving((n) => n - 1);
      }
      router.refresh();
    });
  }
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    persist(arrayMove(items, items.findIndex((f) => f.id === e.active.id), items.findIndex((f) => f.id === e.over!.id)));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nouveau champ</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={List} title="Aucun champ personnalisé" description="Ajoutez les informations propres à votre métier." action={<Button onClick={() => setEditing("new")}>Créer un champ</Button>} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2" aria-busy={saving > 0} data-saving={saving > 0 ? "true" : "false"}>
              {items.map((f, i) => (
                <Row key={f.id} f={f} i={i} total={items.length} roles={roles} onEdit={() => setEditing(f)} onMove={(d) => persist(arrayMove(items, i, i + d))} onDelete={() => setToDelete(f)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {editing && <FieldDialog key={editing === "new" ? "new" : editing.id} field={editing === "new" ? null : editing} roles={roles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer « {toDelete?.label} » ?</DialogTitle>
            <DialogDescription>Les valeurs déjà saisies sur les leads seront perdues. Vous pouvez plutôt masquer ce champ.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setToDelete(null)}>Annuler</Button>
            <Button
              variant="secondary"
              onClick={() => start(async () => {
                const f = toDelete!;
                const res = await saveFieldAction({ id: f.id, label: f.label, type: f.type, required: false, choices: f.options.choices, multiple: f.options.multiple, min: f.options.min, max: f.options.max, visibleRoles: [], editableRoles: [] });
                if (res.ok) { toast.success("Champ masqué."); setToDelete(null); router.refresh(); } else toast.error(res.error);
              })}
            >
              Masquer
            </Button>
            <Button variant="destructive" loading={pending} onClick={() => start(async () => {
              const res = await deleteFieldAction({ id: toDelete!.id });
              if (res.ok) { toast.success("Champ supprimé."); setToDelete(null); router.refresh(); } else toast.error(res.error);
            })}>
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldDialog({ field, roles, onClose, onSaved }: { field: FieldRow | null; roles: RoleOpt[]; onClose: () => void; onSaved: () => void }) {
  const nonAdmin = roles.filter((r) => !r.is_admin);
  const allIds = nonAdmin.map((r) => r.id);
  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const [required, setRequired] = useState(field?.required ?? false);
  const [choices, setChoices] = useState<string[]>(field?.options.choices ?? ["", ""]);
  const [multiple, setMultiple] = useState(field?.options.multiple ?? false);
  const [min, setMin] = useState(field?.options.min === undefined ? "" : String(field.options.min));
  const [max, setMax] = useState(field?.options.max === undefined ? "" : String(field.options.max));
  const [view, setView] = useState<string[]>(field?.visible_roles ?? allIds);
  const [edit, setEdit] = useState<string[]>(field?.editable_roles ?? allIds);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toggle = (list: string[], set: (l: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));
  const norm = (l: string[]) => (allIds.every((id) => l.includes(id)) ? null : l);

  const clearFe = (...keys: string[]) => setFe((cur) => (keys.some((k) => k in cur) ? Object.fromEntries(Object.entries(cur).filter(([k]) => !keys.includes(k))) : cur));

  function save() {
    setFe({});
    start(async () => {
      const res = await saveFieldAction({
        id: field?.id, label, type, required,
        choices: type === "select" ? choices.map((c) => c.trim()).filter(Boolean) : undefined,
        multiple: type === "select" ? multiple : undefined,
        min: type === "number" && min !== "" ? Number(min) : undefined,
        max: type === "number" && max !== "" ? Number(max) : undefined,
        visibleRoles: norm(view), editableRoles: norm(edit.filter((id) => view.includes(id))),
      });
      if (res.ok) { toast.success(field ? "Champ mis à jour." : "Champ créé."); onSaved(); }
      else { setFe(res.fieldErrors ?? {}); if (!res.fieldErrors) toast.error(res.error); }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle>{field ? "Modifier le champ" : "Nouveau champ"}</DialogTitle>
          <DialogDescription>Ce champ apparaîtra sur la fiche lead, dans cet ordre.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="f-label">Nom</Label>
            <Input id="f-label" value={label} onChange={(e) => { setLabel(e.target.value); clearFe("label"); }} aria-invalid={fe.label ? true : undefined} />
            <FieldError id="f-label-error" message={fe.label} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Type</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Type de champ">
              {(Object.keys(FIELD_TYPE_META) as FieldType[]).map((t) => {
                const Icon = FIELD_TYPE_META[t].icon;
                return (
                  <button key={t} type="button" role="radio" aria-checked={type === t} disabled={!!field && field.type !== t} onClick={() => { setType(t); clearFe("choices", "min", "max"); }}
                    className={cn("flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:border-muted-foreground/60 disabled:opacity-40", type === t && "border-accent bg-accent-soft")}>
                    <Icon className="size-4" aria-hidden /> {FIELD_TYPE_META[t].label}
                  </button>
                );
              })}
            </div>
            {field && <p className="text-xs text-muted-foreground">Le type ne peut plus être modifié après la création.</p>}
          </fieldset>
          {type === "number" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="f-min">Minimum (0 par défaut)</Label><Input id="f-min" type="number" step="any" value={min} onChange={(e) => { setMin(e.target.value); clearFe("min", "max"); }} aria-invalid={fe.min ? true : undefined} /><FieldError id="f-min-error" message={fe.min} /></div>
              <div className="space-y-2"><Label htmlFor="f-max">Maximum</Label><Input id="f-max" type="number" step="any" value={max} onChange={(e) => { setMax(e.target.value); clearFe("min", "max"); }} /></div>
            </div>
          )}
          {type === "select" && (
            <div className="space-y-2">
              <Label>Options</Label>
              {choices.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label={`Option ${i + 1}`} value={c} onChange={(e) => { setChoices(choices.map((x, j) => (j === i ? e.target.value : x))); clearFe("choices"); }} />
                  <Button size="icon" variant="ghost" aria-label={`Retirer l'option ${i + 1}`} disabled={choices.length <= 2} onClick={() => setChoices(choices.filter((_, j) => j !== i))}><X className="size-4" /></Button>
                </div>
              ))}
              <FieldError id="f-choices-error" message={fe.choices} />
              <div className="flex flex-wrap items-center gap-4">
                <Button size="sm" variant="outline" onClick={() => { setChoices([...choices, ""]); clearFe("choices"); }}><Plus className="size-3.5" /> Ajouter une option</Button>
                <label className="flex items-center gap-2 text-sm"><Switch checked={multiple} onCheckedChange={setMultiple} /> Choix multiple</label>
              </div>
            </div>
          )}
          <label className="flex items-center justify-between gap-2 text-sm font-medium">
            Obligatoire <Switch aria-label="Obligatoire" checked={required} onCheckedChange={setRequired} />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Visibilité par rôle</legend>
            <p className="text-xs text-muted-foreground">Les administrateurs voient et modifient toujours le champ.</p>
            {nonAdmin.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-4 text-sm">
                <span className="w-32">{r.name}</span>
                <label className="flex items-center gap-2"><Checkbox aria-label={`${r.name} : voir`} checked={view.includes(r.id)} onCheckedChange={(v) => toggle(view, setView, r.id, v === true)} /> Voir</label>
                <label className="flex items-center gap-2"><Checkbox aria-label={`${r.name} : modifier`} checked={edit.includes(r.id) && view.includes(r.id)} disabled={!view.includes(r.id)} onCheckedChange={(v) => toggle(edit, setEdit, r.id, v === true)} /> Modifier</label>
              </div>
            ))}
          </fieldset>
          <Button className="w-full" onClick={save} loading={pending}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
