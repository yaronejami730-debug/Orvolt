import { Skeleton } from "@/components/ui/skeleton";

/** Squelette affiché instantanément pendant le rendu serveur d'une page de l'espace (titre + description + cartes). */
export default function AppLoading() {
  return (
    <div className="space-y-6" data-loading-skeleton aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-[34px] w-44" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
