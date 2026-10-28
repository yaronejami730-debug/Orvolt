"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createLeadAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { canEditField, coerceFormValue, type CustomFieldDef } from "@/lib/custom-fields";
import type { LeadsMeta } from "@/lib/leads/types";

export function CustomFieldInput({ field, value, onChange, error, id }: { field: CustomFieldDef; value: string | string[] | undefined; onChange: (v: string | string[]) => void; error?: string; id: string }) {
  const bad = { "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined } as const;
  const choices = field.options?.choices ?? [];
  let input: React.ReactNode;
  if (field.type === "select" && field.options?.multiple) {
    const cur = Array.isArray(value) ? value : [];
    input = (
      <div className="flex flex-wrap gap-3">
        {choices.map((c) => (
          <label key={c} className="flex items-center gap-2 text-sm">
            <Checkbox checked={cur.includes(c)} onCheckedChange={(v) => onChange(v === true ? [...cur, c] : cur.filter((x) => x !== c))} aria-label={c} /> {c}
          </label>
        ))}
      </div>
    );
  } else if (field.type === "select") {
    input = (
      <Select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} {...bad}>
        <option value="">—</option>
        {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
    );
  } else if (field.type === "file") {
    input = <p className="text-xs text-muted-foreground">Ajoutez les fichiers depuis la fiche du lead.</p>;
  } else {
    input = (
      <Input id={id} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} step={field.type === "number" ? "any" : undefined}
        value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} {...bad} />
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{field.label}{field.required && " *"}</Label>
      {input}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function LeadFormDialog({ meta, open, onOpenChange, defaultStatusId }: { meta: LeadsMeta; open: boolean; onOpenChange: (o: boolean) => void; defaultStatusId?: string }) {
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string | string[]>>({});
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const ctx = { roleId: meta.roleId, isAdmin: meta.isAdmin };
  const fields = meta.fields.filter((f) => canEditField(f, ctx) && f.type !== "file");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.value }));
  const bad = (k: string) => ({ "aria-invalid": fe[k] ? true : undefined });

  const [dupWarning, setDupWarning] = useState<string>();

  function submit(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    const customOut: Record<string, unknown> = {};
    for (const f of fields) {
      const c = coerceFormValue(f, custom[f.key]);
      if (c !== undefined && c !== null) customOut[f.key] = c;
    }
    start(async () => {
      const res = await createLeadAction({
        firstName: v.firstName ?? "", lastName: v.lastName ?? "", company: v.company || null, email: v.email || null, phone: v.phone || null,
        address: v.address || null, city: v.city || null, postalCode: v.postalCode || null,
        value: v.value ? Number(v.value) : null, sourceId: v.sourceId || null, callDomainId: v.callDomainId || null, assignedTo: v.assignedTo || null,
        statusId: v.statusId || defaultStatusId || null, custom: customOut, allowDuplicate,
      });
      if (res.ok) {
        toast.success("Lead créé.");
        setV({}); setCustom({}); setFe({}); setDupWarning(undefined); onOpenChange(false);
        qc.invalidateQueries({ queryKey: ["leads"] });
      } else if (res.code === "duplicate") {
        setDupWarning(res.error);
      } else {
        setDupWarning(undefined);
        setFe(res.fieldErrors ?? {});
        if (!res.fieldErrors) toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle>Nouveau lead</DialogTitle>
          <DialogDescription>Renseignez au moins un nom ou une société.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="l-first">Prénom</Label><Input id="l-first" value={v.firstName ?? ""} onChange={set("firstName")} {...bad("firstName")} /><FieldError id="l-first-error" message={fe.firstName} /></div>
            <div className="space-y-2"><Label htmlFor="l-last">Nom</Label><Input id="l-last" value={v.lastName ?? ""} onChange={set("lastName")} {...bad("lastName")} /><FieldError id="l-last-error" message={fe.lastName} /></div>
            <div className="space-y-2"><Label htmlFor="l-company">Société</Label><Input id="l-company" value={v.company ?? ""} onChange={set("company")} /></div>
            <div className="space-y-2"><Label htmlFor="l-phone">Téléphone</Label><Input id="l-phone" type="tel" value={v.phone ?? ""} onChange={set("phone")} {...bad("phone")} /><FieldError id="l-phone-error" message={fe.phone} /></div>
            <div className="space-y-2"><Label htmlFor="l-email">E-mail</Label><Input id="l-email" type="email" value={v.email ?? ""} onChange={set("email")} {...bad("email")} /><FieldError id="l-email-error" message={fe.email} /></div>
            <div className="space-y-2"><Label htmlFor="l-value">Valeur (€)</Label><Input id="l-value" type="number" min={0} step="any" value={v.value ?? ""} onChange={set("value")} {...bad("value")} /><FieldError id="l-value-error" message={fe.value} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="l-address">Adresse</Label><Input id="l-address" value={v.address ?? ""} onChange={set("address")} /></div>
            <div className="space-y-2"><Label htmlFor="l-postal">Code postal</Label><Input id="l-postal" value={v.postalCode ?? ""} onChange={set("postalCode")} /></div>
            <div className="space-y-2"><Label htmlFor="l-city">Ville</Label><Input id="l-city" value={v.city ?? ""} onChange={set("city")} /></div>
            <div className="space-y-2">
              <Label htmlFor="l-source">Source</Label>
              <Select id="l-source" value={v.sourceId ?? ""} onChange={set("sourceId")}>
                <option value="">—</option>
                {meta.sources.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            {meta.callDomains.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="l-domain">Domaine</Label>
                <Select id="l-domain" value={v.callDomainId ?? ""} onChange={set("callDomainId")}>
                  <option value="">—</option>
                  {meta.callDomains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="l-assigned">Assigné à</Label>
              <Select id="l-assigned" value={v.assignedTo ?? ""} onChange={set("assignedTo")}>
                <option value="">Non assigné</option>
                {meta.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="l-status">Statut</Label>
              <Select id="l-status" value={v.statusId ?? defaultStatusId ?? ""} onChange={set("statusId")}>
                <option value="">Statut initial</option>
                {meta.statuses.filter((s) => s.kind === "normal" && meta.creatable.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          </div>
          {fields.length > 0 && (
            <fieldset className="space-y-4 rounded-lg border p-4">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Informations métier</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <CustomFieldInput key={f.id} id={`cf-${f.key}`} field={f} value={custom[f.key]} onChange={(val) => setCustom((c) => ({ ...c, [f.key]: val }))} error={fe[`custom.${f.key}`]} />
                ))}
              </div>
            </fieldset>
          )}
          {dupWarning && (
            <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="lead-duplicate-warning">
              <p>{dupWarning}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" loading={pending} onClick={(e) => submit(e, true)}>Créer quand même</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDupWarning(undefined)}>Modifier</Button>
              </div>
            </div>
          )}
          <Button type="submit" className="w-full" loading={pending}>Créer le lead</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
