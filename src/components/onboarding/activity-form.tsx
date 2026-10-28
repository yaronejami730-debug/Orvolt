"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, Check, HardHat, Headset } from "lucide-react";
import { toast } from "sonner";
import { saveProfileAction } from "@/app/(app)/settings/partners/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Kind = "installer" | "agency";

function YesNo({ label, hint, value, onChange, name, noLabel = "Non" }: { label: string; hint?: string; value: boolean | null; onChange: (v: boolean) => void; name: string; noLabel?: string }) {
  return (
    <fieldset className="space-y-2" data-testid={`q-${name}`}>
      <legend className="text-sm font-medium">{label}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="flex gap-2" role="radiogroup" aria-label={label}>
        {[true, false].map((b) => (
          <button key={String(b)} type="button" role="radio" aria-checked={value === b} onClick={() => onChange(b)}
            className={cn("h-10 min-w-24 rounded-md border px-4 text-sm font-medium transition-colors", value === b ? "border-accent bg-accent-soft" : "bg-card hover:border-muted-foreground/60")}>
            {b ? "Oui" : noLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ActivityForm({ initialType }: { initialType: Kind | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState<Kind | null>(initialType);
  const [posers, setPosers] = useState<boolean | null>(null);
  const [agencies, setAgencies] = useState<boolean | null>(null);
  const [alsoAgency, setAlsoAgency] = useState<boolean | null>(null);
  const [sub, setSub] = useState<boolean | null>(null);

  const ready = type === "installer" ? posers !== null && agencies !== null && alsoAgency !== null : type === "agency" ? sub !== null : false;
  const save = () => start(async () => {
    const r = await saveProfileAction({ type, managesInstallers: !!posers, worksWithAgencies: !!agencies, alsoAgency: !!alsoAgency, managesSubAgencies: !!sub });
    if (!r.ok) { toast.error(r.error); return; }
    // Qui gère des régies partenaires les crée tout de suite ; les autres passent directement à leur espace.
    const withAgencies = type === "agency" ? !!sub : !!agencies || !!alsoAgency;
    void withAgencies;
    router.push("/onboarding/plan"); // étape suivante : la formule (la page décide ensuite de la destination finale)
    router.refresh();
  });

  const choices: { id: Kind; title: string; text: string; icon: typeof HardHat }[] = [
    { id: "installer", title: "Je suis installateur", text: "Je réalise les chantiers (pompes à chaleur, photovoltaïque…).", icon: HardHat },
    { id: "agency", title: "Je suis une régie", text: "Je génère et confirme des rendez-vous (téléprospection).", icon: Headset },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Votre activité">
        {choices.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={type === c.id} data-testid={`kind-${c.id}`} onClick={() => setType(c.id)}
            className={cn("relative rounded-xl border bg-card p-4 text-left transition-colors hover:border-muted-foreground/60", type === c.id && "border-accent bg-accent-soft")}>
            <c.icon className="size-6 text-link" aria-hidden />
            <span className="mt-2 block font-medium">{c.title}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{c.text}</span>
            {type === c.id && <Check className="absolute right-3 top-3 size-4 text-link" aria-hidden />}
          </button>
        ))}
      </div>

      {type === "installer" && (
        <Card className="space-y-5 p-5">
          <YesNo name="posers" label="Gérez-vous des poseurs ?" hint="Vos équipes qui réalisent les installations." value={posers} onChange={setPosers} />
          <YesNo name="agencies" label="Travaillez-vous déjà avec une ou plusieurs régies ?" hint="Des régies qui prospectent et prennent des rendez-vous pour vous." value={agencies} onChange={setAgencies} />
          <YesNo name="also" label="Êtes-vous vous-même une régie ?" hint="Vous prospectez aussi en interne, avec vos propres téléprospecteurs." value={alsoAgency} onChange={setAlsoAgency} />
        </Card>
      )}
      {type === "agency" && (
        <Card className="space-y-5 p-5">
          <YesNo name="sub" noLabel="Non, pas pour l'instant" label="Gérez-vous des régies partenaires (sous-régies) ?" hint="Chaque sous-régie a son propre espace, qu'elle seule voit ; vous accédez à tous. Pas de souci si ce n'est pas encore le cas : vous pourrez en ajouter plus tard dans Paramètres > Régies partenaires." value={sub} onChange={setSub} />
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button size="lg" loading={pending} disabled={!ready} onClick={save}><Building2 className="size-4" aria-hidden />Continuer</Button>
      </div>
    </div>
  );
}
