"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { setMemberDomainsAction } from "@/app/(app)/settings/call-scripts/actions";
import { AssignmentRows, type ProgContext } from "@/components/settings/call-assignments";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Assignment } from "@/lib/call-programming";

/** Case à cocher d'un domaine (réutilisée par la fiche membre et le dialogue d'ajout). */
export function DomainChecks({ domains, value, onChange, idPrefix }: { domains: ProgContext["domains"]; value: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  if (domains.length === 0) return <p className="text-sm text-muted-foreground">Aucun domaine créé. Ajoutez-en dans Paramètres &gt; Formulaires d&apos;appel.</p>;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Domaines de travail">
      {domains.map((d) => (
        <label key={d.id} htmlFor={`${idPrefix}-${d.id}`} className={`flex items-center gap-2 text-sm ${d.active ? "" : "text-muted-foreground"}`}>
          <Checkbox id={`${idPrefix}-${d.id}`} checked={value.includes(d.id)} onCheckedChange={(c) => onChange(c ? [...value, d.id] : value.filter((x) => x !== d.id))} />
          {d.name}{d.active ? "" : " (inactif)"}
        </label>
      ))}
    </div>
  );
}

/** Section « Formulaires d'appel » de la fiche d'un membre : domaines de travail, programmation et aperçu du jour. */
export function MemberCallProgramming({ userId, name, ctx, memberDomainIds, assignments, preview, now }: {
  userId: string; name: string; ctx: ProgContext; memberDomainIds: string[]; assignments: Assignment[]; preview: { name: string; isDefault: boolean }[]; now: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState(memberDomainIds);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDomains(memberDomainIds); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Formulaires d'appel de ${name}`}><ClipboardList className="size-4" /> Formulaires</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Formulaires d&apos;appel de {name}</DialogTitle>
          <DialogDescription>Domaines de travail et programmation : quel formulaire apparaît, et quand (heure de Paris).</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <section className="space-y-2" aria-label="Domaines de travail">
            <h3 className="text-sm font-semibold">Domaine(s) de travail</h3>
            <DomainChecks domains={ctx.domains} value={domains} onChange={setDomains} idPrefix={`md-${userId}`} />
            <Button size="sm" loading={pending} onClick={() => start(async () => {
              const r = await setMemberDomainsAction({ userId, domainIds: domains });
              if (r.ok) { toast.success("Domaines enregistrés."); router.refresh(); } else toast.error(r.error);
            })}>Enregistrer les domaines</Button>
          </section>
          <section className="space-y-2 rounded-lg bg-muted/40 p-3" aria-label="Aperçu" data-testid="member-preview">
            <h3 className="text-sm font-semibold">Aujourd&apos;hui, ce téléprospecteur verra</h3>
            {preview.length === 0 ? <p className="text-sm text-muted-foreground">Aucun formulaire pour le moment.</p> : (
              <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                {preview.map((p) => <li key={p.name}>{p.name}{p.isDefault ? " (ouvert par défaut)" : ""}</li>)}
              </ol>
            )}
          </section>
          <section className="space-y-2" aria-label="Programmation">
            <h3 className="text-sm font-semibold">Programmation</h3>
            <AssignmentRows items={assignments} ctx={ctx} now={now} show="target" fixed={{ userId }} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
