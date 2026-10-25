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

export function StatCard({ label, value, delta, hint, loading, className }: StatCardProps) {
  return (
    <Card className={cn("p-5 ", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] tabular-nums">{value ?? "–"}</p>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined && !loading && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", delta >= 0 ? "text-success-text" : "text-destructive-text")}>
            {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta)} %
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </Card>
  );
}
