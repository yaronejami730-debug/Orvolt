"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarPlus, Download, Mail, Pencil, Phone, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  addCallAction, addNoteAction, deleteFileAction, deleteLeadAction, deleteNoteAction, fileUrlAction, moveLeadAction, updateLeadAction, updateNoteAction, uploadFileAction,
} from "@/app/(app)/leads/actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { canEditField, coerceFormValue, type CustomFieldDef } from "@/lib/custom-fields";
import { canMoveClient, leadName, type LeadRow, type LeadsMeta } from "@/lib/leads/types";
import { FILE_MAX_BYTES, OUTCOME_LABEL, validateUpload } from "@/lib/validation/leads";
import { AppointmentsTab } from "@/components/agenda/appointments-tab";
import type { ApptRow } from "@/app/(app)/agenda/actions";
import { ago, dateFr, eur } from "./format";
import { CustomFieldInput } from "./lead-form";
import { ScriptRunner, type LeadScript, type ScriptRun } from "./script-runner";

export interface DetailData {
  lead: LeadRow;
  events: { id: string; type: string; payload: Record<string, unknown>; actor_id: string | null; created_at: string }[];
  notes: { id: string; author_id: string; body: string; created_at: string }[];
  calls: { id: string; caller_id: string; outcome: string; duration_seconds: number; notes: string | null; called_at: string }[];
  files: { id: string; name: string; size_bytes: number; mime_type: string; created_at: string }[];
  appts: ApptRow[];
  /** Formulaires d'appel applicables au membre pour ce lead (le premier = par défaut), saisies précédentes, domaines. */
  scripts: LeadScript[];
  runs: ScriptRun[];
  domains: { id: string; name: string; active: boolean }[];
}

type Saver = (value: string | string[]) => Promise<{ ok: boolean; error?: string }>;

/** Édition en ligne : clic, Entrée pour valider, Échap pour annuler ; valeur restaurée en cas d'échec. */
function InlineField({ label, display, initial, editable, field, type = "text", save, id }: {
  label: string; display: string; initial: string | string[]; editable: boolean; field?: CustomFieldDef; type?: string; save: Saver; id: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string | string[]>(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const commit = () =>
    start(async () => {
      const res = await save(value);
      if (res.ok) { setEditing(false); setError(undefined); }
      else { setError(res.error); setValue(initial); }
    });
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>
        {editing ? (
          <div className="space-y-1" onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setValue(initial); setError(undefined); } if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); commit(); } }}>
            {field ? <CustomFieldInput field={field} id={id} value={value} onChange={setValue} error={error} /> : <Input id={id} aria-label={label} autoFocus type={type} value={typeof value === "string" ? value : ""} onChange={(e) => setValue(e.target.value)} aria-invalid={error ? true : undefined} />}
            {!field && <FieldError id={`${id}-error`} message={error} />}
            <div className="flex gap-2">
              <Button size="sm" onClick={commit} loading={pending}>Enregistrer</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(initial); setError(undefined); }}>Annuler</Button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={!editable} onClick={() => setEditing(true)} aria-label={`Modifier ${label}`}
            className="group -mx-1 flex min-h-8 w-full items-center gap-2 rounded px-1 text-left text-sm enabled:hover:bg-muted">
            <span className={display ? "" : "text-muted-foreground"}>{display || "—"}</span>
            {editable && <Pencil className="size-3 opacity-0 group-hover:opacity-60" aria-hidden />}
          </button>
        )}
        {!editing && error && <FieldError id={`${id}-error`} message={error} />}
      </dd>
    </div>
  );
}

const NATIVE_LABEL: Record<string, string> = {
  first_name: "Prénom", last_name: "Nom", company: "Société", email: "E-mail", phone: "Téléphone", address: "Adresse",
  city: "Ville", postal_code: "Code postal", value: "Valeur", source_id: "Source",
};

const EVENT_LABEL = (e: DetailData["events"][number], meta: LeadsMeta): string => {
  const who = (id: unknown) => meta.members.find((m) => m.id === id)?.name ?? "quelqu'un";
  switch (e.type) {
    case "created": return e.payload.via === "import" ? "Lead créé (import CSV)" : e.payload.via === "webhook" ? "Lead créé (webhook entrant)" : "Lead créé";
    case "status_changed": return `Statut : ${e.payload.from_name ?? "?"} → ${e.payload.to_name ?? "?"}`;
    case "assigned": return e.payload.to ? `Assigné à ${who(e.payload.to)}` : "Assignation retirée";
    case "note": return "Note ajoutée";
    case "call": return `Appel journalisé (${OUTCOME_LABEL[String(e.payload.outcome)] ?? "—"})`;
    case "script": return `Formulaire rempli : ${String(e.payload.script_name ?? "")}${e.payload.domain_name ? ` (${String(e.payload.domain_name)})` : ""}`;
    case "file": return `Fichier ajouté : ${String(e.payload.name ?? "")}`;
    case "field_changed": {
      const native = ((e.payload.native as string[] | undefined) ?? []).map((k) => NATIVE_LABEL[k] ?? k);
      const custom = ((e.payload.keys as string[] | undefined) ?? []).map((k) => meta.fields.find((f) => f.key === k)?.label ?? k);
      return `Champs modifiés : ${[...native, ...custom].join(", ")}`;
    }
    case "appointment": {
      const verb: Record<string, string> = { created: "planifié", cancelled: "annulé", updated: "modifié", status: "mis à jour", override: "forcé hors zone", deleted: "supprimé" };
      const when = e.payload.starts_at ? ` le ${dateFr(String(e.payload.starts_at))}` : "";
      const forced = e.payload.override_reason ? ` (dérogation hors zone : ${String(e.payload.override_reason)})` : "";
      return `Rendez-vous ${verb[String(e.payload.action)] ?? ""}${when}${forced}`;
    }
    default: return "Action automatique exécutée";
  }
};

export function LeadDetail({ meta, data }: { meta: LeadsMeta; data: DetailData }) {
  const router = useRouter();
  const { lead } = data;
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState(data.scripts.length > 0 ? "script" : "history"); // le formulaire applicable s'ouvre directement
  const [openNewAppt, setOpenNewAppt] = useState(false); // « Nouveau RDV » (en-tête) ouvre directement le formulaire
  const refresh = () => router.refresh();
  const ctx = { roleId: meta.roleId, isAdmin: meta.isAdmin };
  const member = (id: string | null) => meta.members.find((m) => m.id === id)?.name ?? "—";
  const status = meta.statuses.find((s) => s.id === lead.status_id);

  const makeCore = (key: string, numeric = false) => async (v: string | string[]) => {
    const raw = typeof v === "string" ? v.trim() : "";
    const res = await updateLeadAction({ id: lead.id, core: { [key]: numeric ? (raw === "" ? null : Number(raw)) : raw } });
    if (res.ok) refresh();
    return { ok: res.ok, error: res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error };
  };
  const makeCustom = (f: CustomFieldDef) => async (v: string | string[]) => {
    const res = await updateLeadAction({ id: lead.id, custom: { [f.key]: coerceFormValue(f, v) } });
    if (res.ok) refresh();
    return { ok: res.ok, error: res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error };
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-10 -mx-4 space-y-3 border-b bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Leads</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="lead-title">{leadName(lead)}</h1>
          {status && <Badge color={status.color} dot>{status.name}</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {lead.phone && <Button asChild variant="outline" size="sm"><a href={`tel:${lead.phone}`}><Phone className="size-4" /> Appeler</a></Button>}
            {lead.email && <Button asChild variant="outline" size="sm"><a href={`mailto:${lead.email}`}><Mail className="size-4" /> E-mail</a></Button>}
            {meta.can.appointments && <Button variant="outline" size="sm" onClick={() => { setTab("appointments"); setOpenNewAppt(true); }}><CalendarPlus className="size-4" /> Nouveau RDV</Button>}
            {meta.can.delete && <Button variant="ghost" size="sm" aria-label="Supprimer le lead" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /></Button>}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">Statut
            <Select aria-label="Statut du lead" value={lead.status_id} disabled={!meta.can.edit || pending} className="h-9 w-48"
              onChange={(e) => start(async () => {
                const res = await moveLeadAction({ leadId: lead.id, toStatusId: e.target.value });
                if (res.ok) toast.success("Statut mis à jour."); else toast.error(res.error);
                refresh();
              })}>
              {meta.statuses.map((s) => <option key={s.id} value={s.id} disabled={!canMoveClient(meta, lead.status_id, s.id)} title={canMoveClient(meta, lead.status_id, s.id) ? undefined : "Transition non autorisée pour votre rôle"}>{s.name}</option>)}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm">Assigné à
            {lead.assigned_to && <Avatar name={member(lead.assigned_to)} size="sm" />}
            <Select aria-label="Assigné à" value={lead.assigned_to ?? ""} disabled={!meta.can.edit || pending} className="h-9 w-48"
              onChange={(e) => start(async () => {
                const res = await updateLeadAction({ id: lead.id, core: { assignedTo: e.target.value || null } });
                if (res.ok) toast.success("Assignation mise à jour."); else toast.error(res.error);
                refresh();
              })}>
              <option value="">Non assigné</option>
              {meta.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </label>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="space-y-4 self-start p-5">
          <h2 className="font-semibold">Informations</h2>
          <dl className="space-y-3">
            <InlineField id="f-first" label="Prénom" display={lead.first_name} initial={lead.first_name} editable={meta.can.edit} save={makeCore("firstName")} />
            <InlineField id="f-last" label="Nom" display={lead.last_name} initial={lead.last_name} editable={meta.can.edit} save={makeCore("lastName")} />
            <InlineField id="f-company" label="Société" display={lead.company ?? ""} initial={lead.company ?? ""} editable={meta.can.edit} save={makeCore("company")} />
            <InlineField id="f-phone" label="Téléphone" display={lead.phone ?? ""} initial={lead.phone ?? ""} editable={meta.can.edit} type="tel" save={makeCore("phone")} />
            <InlineField id="f-email" label="E-mail" display={lead.email ?? ""} initial={lead.email ?? ""} editable={meta.can.edit} type="email" save={makeCore("email")} />
            <InlineField id="f-address" label="Adresse" display={[lead.address, lead.postal_code, lead.city].filter(Boolean).join(", ")} initial={lead.address ?? ""} editable={meta.can.edit} save={makeCore("address")} />
            <InlineField id="f-value" label="Valeur" display={eur(lead.value)} initial={lead.value === null ? "" : String(lead.value)} editable={meta.can.edit} type="number" save={makeCore("value", true)} />
            <div className="space-y-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</dt>
              <dd>
                <Select aria-label="Source du lead" value={lead.source_id ?? ""} disabled={!meta.can.edit} className="h-9"
                  onChange={(e) => start(async () => { const r = await updateLeadAction({ id: lead.id, core: { sourceId: e.target.value || null } }); if (!r.ok) toast.error(r.error); refresh(); })}>
                  <option value="">—</option>
                  {meta.sources.filter((s) => !s.archived || s.id === lead.source_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </dd>
            </div>
            {data.domains.length > 0 && (
              <div className="space-y-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Domaine</dt>
                <dd>
                  <Select aria-label="Domaine du lead" value={lead.call_domain_id ?? ""} disabled={!meta.can.edit} className="h-9"
                    onChange={(e) => start(async () => { const r = await updateLeadAction({ id: lead.id, core: { callDomainId: e.target.value || null } }); if (!r.ok) toast.error(r.error); refresh(); })}>
                    <option value="">—</option>
                    {data.domains.filter((d) => d.active || d.id === lead.call_domain_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </dd>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Créé {ago(lead.created_at)}</p>
          </dl>
          {meta.fields.length > 0 && (
            <>
              <h2 className="pt-2 font-semibold">Champs personnalisés</h2>
              <dl className="space-y-3" data-testid="custom-fields">
                {meta.fields.map((f) => {
                  const v = lead.custom[f.key];
                  const display = Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v);
                  return (
                    <InlineField key={f.id} id={`cf-${f.key}`} label={f.label} display={display} editable={meta.can.edit && canEditField(f, ctx) && f.type !== "file"} field={f}
                      initial={Array.isArray(v) ? (v as string[]) : v === undefined || v === null ? "" : String(v)} save={makeCustom(f)} />
                  );
                })}
              </dl>
            </>
          )}
        </Card>

        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="script">Formulaire</TabsTrigger>
            <TabsTrigger value="history">Historique</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="calls">Appels</TabsTrigger>
            <TabsTrigger value="appointments">RDV</TabsTrigger>
            <TabsTrigger value="files">Fichiers</TabsTrigger>
          </TabsList>
          <TabsContent value="script"><ScriptRunner key={`${lead.call_domain_id ?? ""}`} leadId={lead.id} scripts={data.scripts} runs={data.runs} canEdit={meta.can.edit} members={meta.members} /></TabsContent>
          <TabsContent value="history"><History data={data} meta={meta} /></TabsContent>
          <TabsContent value="notes"><Notes data={data} meta={meta} onChange={refresh} /></TabsContent>
          <TabsContent value="calls"><Calls data={data} meta={meta} onChange={refresh} /></TabsContent>
          <TabsContent value="appointments">
            {meta.can.appointments ? (
              <AppointmentsTab openNew={openNewAppt} onOpened={() => setOpenNewAppt(false)} appts={data.appts} members={meta.members} userId={meta.userId} canAssignOthers={meta.can.appointments === "all"} canManage
                lead={{ id: lead.id, label: leadName(lead), address: [lead.address, lead.postal_code, lead.city].filter(Boolean).join(", "), assignedTo: lead.assigned_to }} />
            ) : <EmptyState title="Rendez-vous" description="Vous n'avez pas accès à l'agenda." />}
          </TabsContent>
          <TabsContent value="files"><Files data={data} meta={meta} onChange={refresh} /></TabsContent>
        </Tabs>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce lead ?</DialogTitle>
            <DialogDescription>Notes, appels et fichiers associés seront supprimés. Action irréversible.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Annuler</Button>
            <Button variant="destructive" loading={pending} onClick={() => start(async () => {
              const res = await deleteLeadAction({ id: lead.id });
              if (res.ok) router.push("/leads"); else toast.error(res.error);
            })}>Supprimer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function History({ data, meta }: { data: DetailData; meta: LeadsMeta }) {
  if (data.events.length === 0) return <EmptyState title="Aucune activité" />;
  return (
    <ol className="mt-4 space-y-3" data-testid="history">
      {data.events.map((e) => (
        <li key={e.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
          <div>
            <p>{EVENT_LABEL(e, meta)}</p>
            <p className="text-xs text-muted-foreground">{e.actor_id ? (meta.members.find((m) => m.id === e.actor_id)?.name ?? "—") : "Automatisation"} · {ago(e.created_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Notes({ data, meta, onChange }: { data: DetailData; meta: LeadsMeta; onChange: () => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 space-y-4">
      {meta.can.edit && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => {
          const res = await addNoteAction({ leadId: data.lead.id, body });
          if (res.ok) { setBody(""); setError(undefined); onChange(); } else setError(res.fieldErrors?.body ?? res.error);
        }); }}>
          <Label htmlFor="note-body">Ajouter une note</Label>
          <Textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} aria-invalid={error ? true : undefined} />
          <FieldError id="note-error" message={error} />
          <Button type="submit" size="sm" loading={pending}>Ajouter la note</Button>
        </form>
      )}
      {data.notes.length === 0 ? <EmptyState title="Aucune note" description="Ajoutez la première note sur ce lead." /> : (
        <ul className="space-y-3" data-testid="notes">
          {data.notes.map((n) => (
            <li key={n.id} className="rounded-lg border p-3 text-sm">
              {editId === n.id ? (
                <div className="space-y-2">
                  <Textarea aria-label="Modifier la note" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" loading={pending} onClick={() => start(async () => { const r = await updateNoteAction({ id: n.id, body: editBody }); if (r.ok) { setEditId(null); onChange(); } else toast.error(r.error); })}>Enregistrer</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Annuler</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words">{n.body}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{meta.members.find((m) => m.id === n.author_id)?.name ?? "—"} · {ago(n.created_at)}</span>
                    {n.author_id === meta.userId && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" aria-label="Modifier la note" onClick={() => { setEditId(n.id); setEditBody(n.body); }}><Pencil className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" aria-label="Supprimer la note" onClick={() => start(async () => { const r = await deleteNoteAction({ id: n.id }); if (r.ok) onChange(); else toast.error(r.error); })}><Trash2 className="size-3.5" /></Button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Calls({ data, meta, onChange }: { data: DetailData; meta: LeadsMeta; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("answered");
  const [minutes, setMinutes] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 space-y-4">
      {meta.can.edit && <Button size="sm" onClick={() => setOpen(true)}><Phone className="size-4" /> Journaliser un appel</Button>}
      {data.calls.length === 0 ? <EmptyState title="Aucun appel" description="Journalisez vos appels pour garder l'historique." /> : (
        <ul className="space-y-3" data-testid="calls">
          {data.calls.map((c) => (
            <li key={c.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={c.outcome === "answered" ? "success" : "neutral"}>{OUTCOME_LABEL[c.outcome]}</Badge>
                <span className="text-muted-foreground">{Math.round(c.duration_seconds / 60)} min · {dateFr(c.called_at)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{meta.members.find((m) => m.id === c.caller_id)?.name ?? "—"}</span>
              </div>
              {c.notes && <p className="mt-2 whitespace-pre-wrap">{c.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Journaliser un appel</DialogTitle><DialogDescription>Résultat, durée et commentaire.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => {
            const res = await addCallAction({ leadId: data.lead.id, outcome, durationMinutes: Number(minutes) || 0, notes: notes || undefined });
            if (res.ok) { toast.success("Appel journalisé."); setOpen(false); setNotes(""); setError(undefined); onChange(); } else setError(res.error);
          }); }}>
            <div className="space-y-2"><Label htmlFor="call-outcome">Résultat</Label>
              <Select id="call-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor="call-min">Durée (minutes)</Label><Input id="call-min" type="number" min={0} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="call-notes">Commentaire</Label><Textarea id="call-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></div>
            {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
            <Button type="submit" className="w-full" loading={pending}>Enregistrer l&apos;appel</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Files({ data, meta, onChange }: { data: DetailData; meta: LeadsMeta; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);
  function upload(file: File | undefined) {
    if (!file) return;
    const bad = validateUpload(file.name, file.size, file.type);
    if (bad) return setError(bad);
    setError(undefined);
    const fd = new FormData();
    fd.set("leadId", data.lead.id);
    fd.set("file", file);
    start(async () => {
      const res = await uploadFileAction(fd);
      if (res.ok) { toast.success("Fichier ajouté."); onChange(); } else setError(res.error);
    });
  }
  return (
    <div className="mt-4 space-y-4">
      {meta.can.edit && (
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
          className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm ${drag ? "border-accent bg-accent-soft" : ""}`}>
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <p>Glissez un fichier ici ou</p>
          <Button size="sm" variant="outline" loading={pending} onClick={() => input.current?.click()}>Choisir un fichier</Button>
          <input ref={input} type="file" aria-label="Ajouter un fichier" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          <p className="text-xs text-muted-foreground">Images, PDF, Word, Excel, CSV, texte — {FILE_MAX_BYTES / 1024 / 1024} Mo maximum.</p>
          {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
        </div>
      )}
      {data.files.length === 0 ? <EmptyState title="Aucun fichier" description="Ajoutez devis, photos ou justificatifs." /> : (
        <ul className="space-y-2" data-testid="files">
          {data.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
              <span className="text-xs text-muted-foreground">{(f.size_bytes / 1024).toFixed(f.size_bytes > 102400 ? 0 : 1)} Ko · {ago(f.created_at)}</span>
              <Button size="icon" variant="ghost" aria-label={`Télécharger ${f.name}`} onClick={() => start(async () => { const r = await fileUrlAction({ id: f.id }); if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener"); else toast.error(r.error); })}><Download className="size-4" /></Button>
              {meta.can.edit && <Button size="icon" variant="ghost" aria-label={`Supprimer ${f.name}`} onClick={() => start(async () => { const r = await deleteFileAction({ id: f.id }); if (r.ok) onChange(); else toast.error(r.error); })}><Trash2 className="size-4" /></Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
