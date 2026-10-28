"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { switchOrgAction } from "@/app/(app)/actions";
import { addPartnerManagerAction, createPartnerAction } from "@/app/(app)/settings/partners/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PartnerRow { id: string; name: string; members: number; manager: string | null }

function ManagerFields({ v, set, fe }: { v: { fullName: string; email: string }; set: (k: "fullName" | "email", x: string) => void; fe?: Record<string, string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="mg-name">Nom du responsable</Label><Input id="mg-name" autoComplete="off" value={v.fullName} onChange={(e) => set("fullName", e.target.value)} /><FieldError id="mg-name-e" message={fe?.fullName} /></div>
      <div className="space-y-1.5"><Label htmlFor="mg-mail">E-mail</Label><Input id="mg-mail" type="email" autoComplete="off" value={v.email} onChange={(e) => set("email", e.target.value)} /><FieldError id="mg-mail-e" message={fe?.email} /></div>
    </div>
  );
}

export function PartnersManager({ partners, template }: { partners: PartnerRow[]; template: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [siret, setSiret] = useState("");
  const [phone, setPhone] = useState("");
  const [withManager, setWithManager] = useState(true);
  const [mg, setMg] = useState({ fullName: "", email: "" });
  const [fe, setFe] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState<string | null>(null);
  const [mg2, setMg2] = useState({ fullName: "", email: "" });
  const setM = (k: "fullName" | "email", x: string) => setMg((o) => ({ ...o, [k]: x }));
  const setM2 = (k: "fullName" | "email", x: string) => setMg2((o) => ({ ...o, [k]: x }));

  const create = () => start(async () => {
    setFe({});
    const r = await createPartnerAction({ name, template, siret, phone, manager: withManager && (mg.fullName || mg.email) ? mg : null });
    if (r.ok) { toast.success("Régie partenaire créée."); setName(""); setSiret(""); setPhone(""); setMg({ fullName: "", email: "" }); router.refresh(); }
    else { toast.error(r.error); setFe(r.fieldErrors ?? {}); router.refresh(); }
  });
  const open = (id: string) => start(async () => { const r = await switchOrgAction(id); if (r.ok) { router.push("/dashboard"); router.refresh(); } else toast.error("Accès impossible."); });
  const invite = (orgId: string) => start(async () => {
    const r = await addPartnerManagerAction({ orgId, manager: mg2 });
    if (r.ok) { toast.success("Responsable créé."); setInviting(null); setMg2({ fullName: "", email: "" }); router.refresh(); } else toast.error(r.error);
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Régies partenaires</h2>
        <p className="text-sm text-muted-foreground">Chaque régie partenaire a son propre espace, ses rôles et ses membres. Elle ne voit jamais votre régie. Vous y accédez à tout moment en tant que super administrateur. Ses utilisateurs comptent dans vos places.</p>
      </div>

      <Card className="space-y-4 p-5">
        <h3 className="font-semibold">Nouvelle régie partenaire</h3>
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="partner-name">Nom de la régie</Label>
          <Input id="partner-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Télé-Sud Prospection" />
          <FieldError id="partner-name-e" message={fe.name} />
        </div>
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="partner-siret">SIRET <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="partner-siret" inputMode="numeric" value={siret} onChange={(e) => setSiret(e.target.value)} /><FieldError id="partner-siret-e" message={fe.siret} /></div>
          <div className="space-y-1.5"><Label htmlFor="partner-phone">Téléphone <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="partner-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /><FieldError id="partner-phone-e" message={fe.phone} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withManager} onChange={(e) => setWithManager(e.target.checked)} className="size-4 accent-[var(--accent)]" />Créer maintenant le compte de son responsable (super administrateur de cette régie)</label>
        {withManager && <ManagerFields v={mg} set={setM} fe={fe} />}
        <Button loading={pending} disabled={name.trim().length < 2} onClick={create}><Building2 className="size-4" aria-hidden />Créer la régie</Button>
      </Card>

      {partners.length === 0 ? (
        <EmptyState title="Aucune régie partenaire" description="Créez votre première régie partenaire ci-dessus." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card" data-testid="partners">
          {partners.map((p) => (
            <li key={p.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-muted-foreground">{p.members} utilisateur{p.members > 1 ? "s" : ""} · {p.manager ? `Responsable : ${p.manager}` : "Aucun responsable"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!p.manager && <Button size="sm" variant="outline" onClick={() => setInviting(inviting === p.id ? null : p.id)}><UserPlus className="size-4" aria-hidden />Ajouter un responsable</Button>}
                  <Button size="sm" variant="outline" loading={pending} onClick={() => open(p.id)}><LogIn className="size-4" aria-hidden />Ouvrir</Button>
                </div>
              </div>
              {inviting === p.id && (
                <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                  <ManagerFields v={mg2} set={setM2} />
                  <Button size="sm" loading={pending} onClick={() => invite(p.id)}>Créer le compte</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
