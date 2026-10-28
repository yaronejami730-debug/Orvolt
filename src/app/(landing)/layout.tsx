import "@/styles/marketing.css";

/** Pages d'atterrissage : aucune navigation, aucun pied de page. Seul le contenu de la page compte. */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh">{children}</main>;
}
