import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value?: string | number;
  /** Variation en %, positive ou négative */
  delta?: number;
  hint?: string;
  loading?: boolean;
  className?: string;
}

/* Carte statistique GoCardless : titre 16px/700, valeur 28px/34px 600. */
export function StatCard({ label, value, delta, hint, loading, className }: StatCardProps) {
  return (
    <Card className={cn("p-6", className)}>
      <p className="text-base font-bold leading-[22px]">{label}</p>
      {loading ? (
        <Skeleton className="mt-3 h-[34px] w-24" />
      ) : (
        <p className="mt-2 text-[28px] font-semibold leading-[34px] tabular-nums">{value ?? "–"}</p>
      )}
      <div className="mt-4 flex items-center gap-2 text-sm leading-5">
        {delta !== undefined && !loading && (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", delta >= 0 ? "text-success-text" : "text-destructive-text")}>
            {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta)} %
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </Card>
  );
}
