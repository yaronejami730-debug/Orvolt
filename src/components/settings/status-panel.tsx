"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  saveActionsAction,
  saveTransitionsAction,
  setInitialStatusAction,
  testWebhookAction,
  updateStatusAction,
} from "@/app/(app)/settings/statuses/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ui/color-picker";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { KIND_LABEL, type ActionRow, type MemberOpt, type RoleOpt, type StatusRow, type TransitionRow } from "./workflow-types";

type Cfg = Record<string, unknown>;
interface DraftAction {
  type: ActionRow["type"];
  enabled: boolean;
  config: Cfg;
}

const TYPE_LABEL: Record<ActionRow["type"], string> = {
  assign: "Assigner",
  notify: "Notifier",
  create_task: "Créer une tâche",
  webhook: "Webhook",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

interface PanelProps {
  status: StatusRow;
  statuses: StatusRow[];
  transitions: TransitionRow[];
  actions: ActionRow[];
  roles: RoleOpt[];
  members: MemberOpt[];
  onClose: () => void;
  onSaved: () => void;
}

export function StatusPanel(props: PanelProps) {
  const { status, onClose } = props;
  const [dirty, setDirty] = useState(false);
  const close = () => {
    if (dirty && !window.confirm("Des modifications ne sont pas enregistrées. Fermer quand même ?")) return;
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Édition du statut ${status.name}`}>
      <button aria-label="Fermer le panneau" className="absolute inset-0 bg-black/60" onClick={close} />
      <div className="relative flex h-full w-full flex-col border-l bg-popover shadow-lg md:max-w-xl">
        <div className="flex items-center justify-between gap-2 border-b p-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <h2 className="truncate text-lg font-semibold">{status.name}</h2>
          </div>
          <Button variant="ghost" size="icon" aria-label="Fermer" onClick={close}><X className="size-4" /></Button>
        </div>
        <Tabs defaultValue="general" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-3 self-start">
            <TabsTrigger value="general">Général</TabsTrigger>
            <TabsTrigger value="transitions">Transitions</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <TabsContent value="general"><GeneralTab {...props} setDirty={setDirty} /></TabsContent>
            <TabsContent value="transitions"><TransitionsTab {...props} setDirty={setDirty} /></TabsContent>
            <TabsContent value="actions"><ActionsTab {...props} setDirty={setDirty} /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

type TabProps = PanelProps & { setDirty: (d: boolean) => void };

function GeneralTab({ status, statuses, onSaved, setDirty }: TabProps) {
  const [name, setName] = useState(status.name);
  const [color, setColor] = useState(status.color);
  const [kind, setKind] = useState(status.kind);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const sameKind = statuses.filter((s) => s.kind === kind && s.id !== status.id).length;

  function save() {
    start(async () => {
      const res = await updateStatusAction({ id: status.id, name, color, kind });
      if (res.ok) {
        toast.success("Statut enregistré.");
        setDirty(false);
        setFe({});
        onSaved();
      } else {
        setFe(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  }
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="st-name">Nom</Label>
        <Input id="st-name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-invalid={fe.name ? true : undefined} />
        <FieldError id="st-name-error" message={fe.name} />
      </div>
      <div className="space-y-2">
        <Label>Couleur</Label>
        <ColorPicker value={color} onChange={(c) => { setColor(c); setDirty(true); }} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Type</legend>
        {(["normal", "won", "lost"] as const).map((k) => (
          <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="kind" checked={kind === k} onChange={() => { setKind(k); setDirty(true); }} className="accent-[var(--accent)]" />
            {KIND_LABEL[k]}
          </label>
        ))}
        {kind !== "normal" && (
          <p className="text-xs text-muted-foreground">
            Un statut final n&apos;a pas de transition sortante.{sameKind > 0 && " Plusieurs statuts finals de ce type existent."}
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} loading={pending}>Enregistrer</Button>
        {!status.is_initial && status.kind === "normal" && (
          <Button
            variant="outline"
            onClick={() =>
              start(async () => {
                const res = await setInitialStatusAction({ id: status.id });
                if (res.ok) { toast.success("Statut initial défini."); onSaved(); } else toast.error(res.error);
              })
            }
          >
            Définir comme statut initial
          </Button>
        )}
        {status.is_initial && <span className="text-xs text-muted-foreground">Statut initial des nouveaux leads</span>}
      </div>
    </div>
  );
}

/** roles: "all" | tableau d'ids ; absent = pas de transition. */
type Matrix = Record<string, "all" | string[]>;

function TransitionsTab({ status, statuses, transitions, roles, onSaved, setDirty }: TabProps) {
  const initial: Matrix = {};
  for (const t of transitions.filter((t) => t.from_status_id === status.id)) {
    if (t.role_id === null) initial[t.to_status_id] = "all";
    else if (initial[t.to_status_id] !== "all") initial[t.to_status_id] = [...((initial[t.to_status_id] as string[] | undefined) ?? []), t.role_id];
  }
  const [m, setM] = useState<Matrix>(initial);
  const [pending, start] = useTransition();
  const targets = statuses.filter((s) => s.id !== status.id);
  const nonAdmin = roles.filter((r) => !r.is_admin);

  const set = (id: string, v: "all" | string[] | null) => {
    setM((cur) => {
      const next = { ...cur };
      if (v === null || (Array.isArray(v) && v.length === 0)) delete next[id];
      else next[id] = v;
      return next;
    });
    setDirty(true);
  };
  const toggleRole = (id: string, roleId: string, on: boolean) => {
    const cur = m[id];
    const base = cur === "all" ? nonAdmin.map((r) => r.id) : (cur ?? []);
    set(id, on ? [...base, roleId] : base.filter((r) => r !== roleId));
  };

  if (status.kind !== "normal") {
    return <p className="text-sm text-muted-foreground">Un statut final n&apos;a pas de transition sortante.</p>;
  }
  function save() {
    start(async () => {
      const res = await saveTransitionsAction({
        fromId: status.id,
        targets: Object.entries(m).map(([toId, r]) => ({ toId, roles: r })),
      });
      if (res.ok) { toast.success("Transitions enregistrées."); setDirty(false); onSaved(); } else toast.error(res.error);
    });
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Rôles autorisés à passer de « {status.name} » vers chaque statut. Les administrateurs peuvent toujours déplacer un lead.</p>
      <ul className="space-y-3">
        {targets.map((t) => {
          const cur = m[t.id];
          return (
            <li key={t.id} className="rounded-lg border p-3" data-testid={`transition-${t.name}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant={cur === "all" ? "secondary" : "ghost"} onClick={() => set(t.id, "all")}>Tous les rôles</Button>
                  <Button size="sm" variant={cur === undefined ? "secondary" : "ghost"} onClick={() => set(t.id, null)}>Aucun</Button>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {nonAdmin.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      aria-label={`${r.name} : ${status.name} vers ${t.name}`}
                      checked={cur === "all" || (Array.isArray(cur) && cur.includes(r.id))}
                      onCheckedChange={(v) => toggleRole(t.id, r.id, v === true)}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <Button onClick={save} loading={pending}>Enregistrer les transitions</Button>
    </div>
  );
}

function ActionsTab({ status, actions, roles, members, onSaved, setDirty }: TabProps) {
  const [list, setList] = useState<DraftAction[]>(
    actions.filter((a) => a.status_id === status.id).sort((a, b) => a.position - b.position).map((a) => ({ type: a.type, enabled: a.enabled, config: a.config })),
  );
  const [errors, setErrors] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();

  const patch = (i: number, c: Cfg) => {
    setList((l) => l.map((a, j) => (j === i ? { ...a, config: { ...a.config, ...c } } : a)));
    setDirty(true);
  };
  const add = (type: ActionRow["type"]) => {
    const config: Cfg =
      type === "assign" ? { mode: "role" }
      : type === "notify" ? { recipient: "assignee", message: "" }
      : type === "create_task" ? { title: "", delay: 1, unit: "days", assignee: "assignee" }
      : { url: "" };
    setList((l) => [...l, { type, enabled: true, config }]);
    setDirty(true);
  };

  function save() {
    start(async () => {
      const res = await saveActionsAction({ statusId: status.id, actions: list });
      if (res.ok) { toast.success("Actions enregistrées."); setErrors(undefined); setDirty(false); onSaved(); }
      else { setErrors(res.error); toast.error(res.error); }
    });
  }

  const roleSelect = (i: number, value: unknown, key = "roleId") => (
    <Select aria-label="Rôle" value={str(value)} onChange={(e) => patch(i, { [key]: e.target.value })}>
      <option value="">Choisir un rôle</option>
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </Select>
  );
  const userSelect = (i: number, value: unknown) => (
    <Select aria-label="Utilisateur" value={str(value)} onChange={(e) => patch(i, { userId: e.target.value })}>
      <option value="">Choisir un utilisateur</option>
      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </Select>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Exécutées automatiquement quand un lead entre dans « {status.name} ».</p>
      {list.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Aucune action automatique.</p>}
      <ul className="space-y-3">
        {list.map((a, i) => (
          <li key={i} className="space-y-3 rounded-lg border p-3" data-testid={`action-${a.type}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{TYPE_LABEL[a.type]}</span>
              <span className="flex items-center gap-2">
                <Switch aria-label="Action active" checked={a.enabled} onCheckedChange={(v) => { setList((l) => l.map((x, j) => (j === i ? { ...x, enabled: v } : x))); setDirty(true); }} />
                <Button size="icon" variant="ghost" aria-label="Supprimer l'action" onClick={() => { setList((l) => l.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 className="size-4" /></Button>
              </span>
            </div>
            {a.type === "assign" && (
              <div className="space-y-2">
                <Select aria-label="Mode" value={str(a.config.mode)} onChange={(e) => patch(i, { mode: e.target.value })}>
                  <option value="role">Un rôle</option>
                  <option value="user">Un utilisateur</option>
                </Select>
                {a.config.mode === "user" ? userSelect(i, a.config.userId) : roleSelect(i, a.config.roleId)}
              </div>
            )}
            {a.type === "notify" && (
              <div className="space-y-2">
                <Select aria-label="Destinataire" value={str(a.config.recipient)} onChange={(e) => patch(i, { recipient: e.target.value })}>
                  <option value="assignee">L&apos;assigné</option>
                  <option value="role">Un rôle</option>
                  <option value="user">Un utilisateur</option>
                </Select>
                {a.config.recipient === "role" && roleSelect(i, a.config.roleId)}
                {a.config.recipient === "user" && userSelect(i, a.config.userId)}
                <Textarea aria-label="Message" placeholder="Message" value={str(a.config.message)} onChange={(e) => patch(i, { message: e.target.value })} maxLength={300} />
              </div>
            )}
            {a.type === "create_task" && (
              <div className="space-y-2">
                <Input aria-label="Titre de la tâche" placeholder="Titre de la tâche" value={str(a.config.title)} onChange={(e) => patch(i, { title: e.target.value })} />
                <div className="flex gap-2">
                  <Input aria-label="Délai" type="number" min={0} max={365} value={Number(a.config.delay ?? 0)} onChange={(e) => patch(i, { delay: Number(e.target.value) })} />
                  <Select aria-label="Unité" value={str(a.config.unit)} onChange={(e) => patch(i, { unit: e.target.value })}>
                    <option value="hours">heures</option>
                    <option value="days">jours</option>
                  </Select>
                </div>
                <Select aria-label="Assigné à" value={str(a.config.assignee)} onChange={(e) => patch(i, { assignee: e.target.value })}>
                  <option value="assignee">L&apos;assigné du lead</option>
                  <option value="user">Un utilisateur</option>
                </Select>
                {a.config.assignee === "user" && userSelect(i, a.config.userId)}
              </div>
            )}
            {a.type === "webhook" && (
              <div className="space-y-2">
                <Input aria-label="URL du webhook" placeholder="https://…" value={str(a.config.url)} onChange={(e) => patch(i, { url: e.target.value })} />
                <Button
                  size="sm"
                  variant="outline"
                  loading={testing}
                  onClick={() =>
                    startTest(async () => {
                      const res = await testWebhookAction({ url: a.config.url });
                      if (res.ok) toast.success(`Cible joignable (HTTP ${res.data?.status ?? "?"})`); else toast.error(res.error);
                    })
                  }
                >
                  Tester
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TYPE_LABEL) as ActionRow["type"][]).map((t) => (
          <Button key={t} size="sm" variant="outline" onClick={() => add(t)}><Plus className="size-3.5" /> {TYPE_LABEL[t]}</Button>
        ))}
      </div>
      {errors && <p role="alert" className="text-sm text-destructive">{errors}</p>}
      <Button onClick={save} loading={pending}>Enregistrer les actions</Button>
    </div>
  );
}
