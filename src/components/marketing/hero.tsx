import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ProductDemo } from "./product-demo";

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative isolate overflow-hidden">
      <div className="mk-fluid -z-10" aria-hidden><i /><i /><i /></div>
      <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-20 text-center sm:px-8 sm:pb-24 sm:pt-28">
        <h1 className="mk-rise mx-auto max-w-4xl text-balance text-[2.6rem] font-bold leading-[1.02] tracking-[-0.05em] sm:text-7xl lg:text-[5.25rem]" style={{ ["--i" as string]: 0 }}>
          Suivez chaque lead de l&apos;appel à la signature.
        </h1>
        <p className="mk-rise mx-auto mt-6 max-w-xl text-pretty text-base text-foreground/75 sm:text-lg" style={{ ["--i" as string]: 1 }}>
          Statuts, rendez-vous et relances pour les équipes de terrain. Chacun voit ce qu&apos;il a à faire, pas plus.
        </p>
        <div className="mk-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ ["--i" as string]: 2 }}>
          {signedIn ? (
            <Button asChild size="lg"><Link href="/dashboard">Ouvrir l&apos;app</Link></Button>
          ) : (
            <Button asChild size="lg"><Link href="/signup">Essai gratuit 14 jours</Link></Button>
          )}
          <Button asChild size="lg" variant="secondary"><Link href="/#fonctionnalites">Voir comment ça marche</Link></Button>
        </div>
        <div className="mk-rise mx-auto mt-16 max-w-5xl sm:mt-20" style={{ ["--i" as string]: 4 }}>
          <ProductDemo />
        </div>
      </div>
    </section>
  );
}
