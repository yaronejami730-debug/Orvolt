import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

/** Hauteurs du mot-symbole : sm (menu compact, démo), md (en-têtes), lg (pages d'accueil des formulaires). */
const HEIGHT = { sm: "h-9", md: "h-11", lg: "h-16" } as const;
export type LogoSize = keyof typeof HEIGHT;

/**
 * Mot-symbole Orvolt seul (sans lien). `tone` choisit la version du fichier :
 * - « auto » : noir, repassé en blanc en mode sombre ;
 * - « on-dark » : toujours blanc (fonds sombres fixes, ex. le menu de l'application) ;
 * - « on-light » : toujours noir.
 */
export function LogoImage({ className, size = "md", tone = "auto", priority = false }: { className?: string; size?: LogoSize; tone?: "auto" | "on-dark" | "on-light"; priority?: boolean }) {
  return (
    <Image
      src={tone === "on-dark" ? "/brand/orvolt-logo-white.png" : "/brand/orvolt-logo.png"}
      alt={SITE_NAME}
      width={1000}
      height={564}
      priority={priority}
      className={cn(HEIGHT[size], "w-auto", tone === "auto" && "dark:invert", className)}
    />
  );
}

/** Pastille éclair (petits formats : formulaires, écrans compacts). Blanche sur fond noir, inversée en mode sombre. */
export function LogoMark({ className }: { className?: string }) {
  return <Image src="/brand/orvolt-mark.png" alt="" aria-hidden width={128} height={128} className={cn("size-7 dark:invert", className)} />;
}

/** Logo cliquable (retour à l'accueil par défaut) ; `href={null}` pour l'afficher sans lien (onboarding, pages d'acquisition). */
export function Logo({ className, size = "md", tone = "auto", href = "/", onClick, priority = false }: { className?: string; size?: LogoSize; tone?: "auto" | "on-dark" | "on-light"; href?: string | null; onClick?: () => void; priority?: boolean }) {
  const image = <LogoImage size={size} tone={tone} priority={priority} />;
  if (href === null) return <span className={cn("inline-flex items-center", className)}>{image}</span>;
  return (
    <Link href={href} onClick={onClick} aria-label={`${SITE_NAME}, accueil`} className={cn("inline-flex items-center rounded-md", className)}>
      {image}
    </Link>
  );
}
