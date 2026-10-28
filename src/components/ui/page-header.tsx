import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

/* Titre de page GoCardless : 28px/34px 600, actions à droite. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="min-w-0 space-y-2">
        <h1 className="text-[28px] font-semibold leading-[34px]">{title}</h1>
        {description && <p className="text-sm leading-5 text-secondary-text sm:text-base sm:leading-[22px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
