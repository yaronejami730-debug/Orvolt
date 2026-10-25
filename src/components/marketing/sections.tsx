import Link from "next/link";
import { Flame, Home, MapPin, Sun, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spotlight } from "./spotlight";

/** Phrase géante en deux tons : faits du produit uniquement, aucun chiffre client inventé. */
export function Statement() {
  return (
    <section aria-label="Pourquoi LeadForge" className="py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <p className="max-w-4xl text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.04em] sm:text-5xl">
          Pompe à chaleur, solaire, isolation : un seul pipeline.{" "}
          <span className="text-muted-foreground">Du télépro qui appelle au commercial qui signe, chacun travaille sur le même dossier, au même moment.</span>
        </p>
      </div>
    </section>
  );
}

const TRADES = [
  { icon: Flame, name: "Pompe à chaleur", statuts: "Type de chauffage, surface, classe DPE" },
  { icon: Sun, name: "Panneaux solaires", statuts: "Toiture, facture d'énergie, propriétaire ou locataire" },
  { icon: Home, name: "Isolation", statuts: "Surface habitable, adresse du logement, devis" },
];


export function Trades() {
  return (
    <section aria-labelledby="metiers-title" className="pb-20 sm:pb-28">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 sm:px-8 md:grid-cols-[1fr_1.6fr] md:gap-16">
        <div>
          <h2 id="metiers-title" className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Un modèle prêt pour l&apos;énergie</h2>
          <p className="mt-3 max-w-sm text-muted-foreground">Statuts (Nouveau, À qualifier, RDV pris, Devis envoyé, Signé), champs du logement et sources sont créés à l&apos;inscription. Vous gardez ce qui vous sert, vous changez le reste.</p>
        </div>
        <ul className="divide-y border-y">
          {TRADES.map((t) => (
            <li key={t.name} className="flex items-center gap-4 py-4">
              <t.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="w-32 shrink-0 font-medium sm:w-40">{t.name}</span>
              <span className="min-w-0 text-sm text-muted-foreground">{t.statuts}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function StatusesVisual() {
  const rows = [
    ["À rappeler", "RDV posé", "Prospecteur"],
    ["RDV posé", "Devis envoyé", "Commercial"],
    ["Devis envoyé", "Signé", "Commercial, admin"],
  ];
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(([from, to, who]) => (
        <li key={from} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-background/60 px-3 py-2.5">
          <span className="font-medium">{from}</span>
          <span className="text-muted-foreground" aria-hidden>vers</span>
          <span className="font-medium">{to}</span>
          <span className="ml-auto text-xs text-muted-foreground">{who}</span>
        </li>
      ))}
    </ul>
  );
}

function ZoneVisual() {
  return (
    <ul className="space-y-2 text-sm">
      <li className="flex items-center gap-3 rounded-lg border bg-background/60 px-3 py-2.5">
        <MapPin className="size-4 shrink-0 text-success-text" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Jeu. 14 h, Nantes</span>
        <span className="text-xs text-muted-foreground">12 km, dans la zone</span>
      </li>
      <li className="flex items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5">
        <TriangleAlert className="size-4 shrink-0 text-warning-text" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Ven. 16 h 30, Angers</span>
        <span className="text-xs text-warning-text">88 km, hors zone</span>
      </li>
    </ul>
  );
}

function RolesVisual() {
  const rows = [["Prospecteur", "ses leads"], ["Confirmateur", "les RDV à confirmer"], ["Commercial", "son agenda et ses devis"], ["Administrateur", "toute l'équipe"]];
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([r, v]) => (
        <div key={r} className="flex items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2.5">
          <dt className="font-medium">{r}</dt>
          <dd className="text-xs text-muted-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const BIG: { id: string; title: string; text: string; visual: React.ReactNode; wide?: boolean }[] = [
  { id: "kanban", wide: true, title: "Kanban et statuts programmables", text: "Vous définissez vos étapes, leurs couleurs et qui peut faire passer un lead de l'une à l'autre. Un passage peut assigner le lead, prévenir quelqu'un, créer une tâche ou appeler un webhook.", visual: <StatusesVisual /> },
  { id: "roles", title: "Rôles et permissions", text: "Super administrateur, administrateur, prospecteur, confirmateur, commercial : chacun voit et fait ce qu'il doit, rien de plus.", visual: <RolesVisual /> },
  { id: "rdv", title: "Rendez-vous et contrôle de distance", text: "Un agenda par commercial. Si le lieu sort de sa zone d'intervention, une alerte s'affiche, et toute dérogation est tracée.", visual: <ZoneVisual /> },
];

const SMALL = [
  { id: "champs", title: "Champs personnalisés", text: "Texte, nombre, date, liste, fichier, adresse. La fiche lead reflète votre activité." },
  { id: "import", title: "Import CSV et webhooks", text: "Associez vos colonnes, éliminez les doublons, et recevez vos leads Meta Lead Ads et Google Ads sans ressaisie." },
  { id: "kpi", title: "Tableau de bord KPI", text: "Leads par statut et par source, taux de conversion, rendez-vous, résultats par personne, sur la période de votre choix." },
  { id: "equipes", title: "Multi-équipes sécurisées", text: "Chaque entreprise a son espace séparé. Les données ne se croisent jamais." },
];

export function Features() {
  return (
    <section id="fonctionnalites" aria-labelledby="features-title" className="scroll-mt-20 pb-20 sm:pb-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <h2 id="features-title" className="max-w-2xl text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">Plus qu&apos;un tableau de leads</h2>
        <p className="mt-4 max-w-xl text-muted-foreground sm:text-lg">Qualifier, planifier, relancer, mesurer. Dans un seul outil, sans réglage interminable.</p>

        <div className="mt-12 grid gap-4 md:grid-cols-6">
          {BIG.map((f) => (
            <Spotlight as="article" key={f.id} className={f.wide ? "p-6 sm:p-8 md:col-span-6 md:grid md:grid-cols-2 md:items-center md:gap-10" : "p-6 sm:p-8 md:col-span-3"}>
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl">{f.title}</h3>
                <p className="mt-3 text-muted-foreground">{f.text}</p>
              </div>
              <div className={f.wide ? "mt-6 md:mt-0" : "mt-6"}>{f.visual}</div>
            </Spotlight>
          ))}
        </div>

        <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {SMALL.map((f) => (
            <article key={f.id} className="border-t pt-5">
              <h3 className="text-base font-semibold tracking-[-0.02em]">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Démarrez avec le modèle énergie", text: "Pompe à chaleur, panneaux solaires, isolation. Statuts, champs et sources sont créés à l'inscription." },
  { title: "Adaptez-le à votre façon de vendre", text: "Renommez une étape, ajoutez un champ, réglez les droits de chaque rôle, branchez vos sources de leads." },
  { title: "Invitez l'équipe et lancez-vous", text: "Chacun se connecte depuis son téléphone. Vous suivez le Kanban, l'agenda et les chiffres au même endroit." },
];

export function HowItWorks() {
  return (
    <section id="comment-ca-marche" aria-labelledby="how-title" className="scroll-mt-20 pb-20 sm:pb-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <h2 id="how-title" className="max-w-2xl text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">Prêt en trois étapes</h2>
        <ol className="mt-12 divide-y border-y">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid gap-2 py-7 sm:grid-cols-[6rem_1fr_1.4fr] sm:gap-8">
              <span className="text-4xl font-semibold tracking-[-0.04em] text-muted-foreground tabular-nums" aria-hidden>{i + 1}</span>
              <h3 className="text-xl font-semibold tracking-[-0.03em]"><span className="sr-only">Étape {i + 1} : </span>{s.title}</h3>
              <p className="text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="cta-title" className="relative isolate overflow-hidden border-t py-24 sm:py-32">
      <div className="mk-fluid -z-10 [transform:scaleY(-1)]" aria-hidden><i /><i /><i /></div>
      <div className="mx-auto w-full max-w-3xl px-5 text-center sm:px-8">
        <h2 id="cta-title" className="text-balance text-4xl font-bold tracking-[-0.05em] sm:text-6xl">Vos leads méritent mieux qu&apos;un tableur.</h2>
        <p className="mx-auto mt-5 max-w-lg text-muted-foreground sm:text-lg">Créez votre espace, importez vos contacts et invitez l&apos;équipe. L&apos;essai dure 14 jours.</p>
        <div className="mt-9 flex justify-center">
          {signedIn ? (
            <Button asChild size="lg"><Link href="/dashboard">Ouvrir l&apos;app</Link></Button>
          ) : (
            <Button asChild size="lg"><Link href="/signup">Essai gratuit 14 jours</Link></Button>
          )}
        </div>
      </div>
    </section>
  );
}

