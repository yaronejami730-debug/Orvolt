import { Check, MapPin, Phone, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoImage } from "./logo";

/* Maquette du pipeline : un lead glisse de « Devis envoyé » à « Signé » (boucle CSS de 10 s, voir marketing.css). */

type Lead = { name: string; city: string; job: string; who: string; amount?: string };
const COLS: { name: string; color: string; leads: Lead[]; hideOnMobile?: boolean }[] = [
  { name: "À rappeler", color: "#8a93a6", hideOnMobile: true, leads: [
    { name: "M. Benali", city: "Villeurbanne", job: "Isolation des combles", who: "KL" },
    { name: "Mme Lefèvre", city: "Rezé", job: "Pompe à chaleur", who: "SD" },
  ] },
  { name: "RDV posé", color: "#4170ff", leads: [
    { name: "M. Roux", city: "Nîmes", job: "Panneaux solaires", who: "MA", amount: "Jeu. 14 h" },
    { name: "SCI Duval", city: "Bordeaux", job: "Toiture", who: "MA", amount: "Ven. 9 h" },
  ] },
  { name: "Devis envoyé", color: "#e8b052", leads: [
    { name: "Mme Garnier", city: "Tours", job: "Pompe à chaleur", who: "TR", amount: "11 900 €" },
    { name: "M. Perrin", city: "Annecy", job: "Isolation extérieure", who: "TR", amount: "8 400 €" },
  ] },
  { name: "Signé", color: "#4cc983", leads: [
    { name: "M. Hamon", city: "Rennes", job: "Panneaux solaires", who: "MA", amount: "14 200 €" },
  ] },
];

function Mini({ lead, className, style }: { lead: Lead; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("rounded-lg border bg-card p-2 text-left sm:p-3", className)} style={style}>
      <p className="truncate text-xs font-medium leading-tight sm:text-[13px]">{lead.name}</p>
      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground"><MapPin className="size-3 shrink-0" aria-hidden />{lead.city}</p>
      <p className="mt-2 hidden truncate text-[11px] text-muted-foreground sm:block">{lead.job}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-semibold text-foreground">{lead.who}</span>
        {lead.amount && <span className="hidden truncate font-medium tabular-nums sm:block">{lead.amount}</span>}
      </div>
    </div>
  );
}

function Cursor({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 drop-shadow", className)} aria-hidden>
      <path d="M5 3l14 8-6 1.8L10.5 19z" fill="#fff" stroke="#05070d" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function ProductDemo() {
  return (
    <div className="mk-frame rounded-[22px] p-2 text-left sm:p-3" role="img" aria-label="Aperçu du pipeline de leads : un lead passe de Devis envoyé à Signé">
      <div className="mk-demo relative overflow-hidden rounded-[14px] border bg-background text-foreground">
        <div className="flex min-h-[340px] sm:min-h-[380px]">
          <aside className="hidden w-44 shrink-0 flex-col gap-1 border-r p-3 text-sm md:flex">
            <div className="px-2 pb-3"><LogoImage size="sm" /></div>
            {["Tableau de bord", "Leads", "Agenda", "Import"].map((l) => (
              <span key={l} className={cn("rounded-md px-2 py-1.5 text-[13px] text-muted-foreground", l === "Leads" && "bg-muted font-medium text-foreground")}>{l}</span>
            ))}
          </aside>
          <div className="min-w-0 flex-1 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-[-0.03em]">Pompes à chaleur, Ouest</p>
                <p className="text-xs text-muted-foreground">7 leads actifs</p>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="flex h-8 w-44 items-center gap-2 rounded-md border px-2.5 text-xs text-muted-foreground"><Search className="size-3.5" aria-hidden />Chercher un lead</span>
                <span className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground">Nouveau lead</span>
              </div>
            </div>

            <div className="relative mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-2" style={{ ["--gap" as string]: "8px" }}>
              {COLS.map((c) => (
                <div key={c.name} className={cn("min-w-0 space-y-2", c.hideOnMobile && "hidden sm:block")}>
                  <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium sm:text-xs">
                    <span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden />
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto text-muted-foreground tabular-nums">{c.leads.length + (c.name === "Signé" ? 1 : 0)}</span>
                  </div>
                  {c.name === "Devis envoyé" && (
                    <div className="relative">
                      {/* le lead qui bouge : c'est lui qui porte l'animation et le curseur */}
                      <div className="mk-demo-card relative">
                        <Mini lead={c.leads[0]!} />
                        <Cursor className="mk-demo-cursor absolute -bottom-3 right-3" />
                      </div>
                    </div>
                  )}
                  {c.name === "Signé" && (
                    <div className="mk-demo-target">
                      <Mini lead={{ name: "Mme Garnier", city: "Tours", job: "Pompe à chaleur", who: "TR", amount: "11 900 €" }} className="border-accent/60" />
                    </div>
                  )}
                  {c.leads.slice(c.name === "Devis envoyé" ? 1 : 0).map((l) => <Mini key={l.name} lead={l} />)}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mk-demo-toast pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
          <p className="flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
            <span className="grid size-5 place-items-center rounded-full bg-success text-white"><Check className="size-3" strokeWidth={3} aria-hidden /></span>
            Mme Garnier, Tours : passée en Signé
            <Phone className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden />
          </p>
        </div>
      </div>
    </div>
  );
}
