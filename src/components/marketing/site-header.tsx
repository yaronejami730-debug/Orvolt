"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "./logo";

export const NAV_LINKS = [
  { href: "/#fonctionnalites", label: "Fonctionnalités" },
  { href: "/#comment-ca-marche", label: "Comment ça marche" },
  { href: "/pricing", label: "Tarifs" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("a")?.focus(); // le focus entre dans le menu à l'ouverture
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus(); // et revient sur le bouton à la fermeture
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const primary = signedIn ? (
    <Button asChild size="sm"><Link href="/dashboard">Ouvrir l&apos;app</Link></Button>
  ) : (
    <Button asChild size="sm"><Link href="/signup">Essai gratuit</Link></Button>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/60 backdrop-blur-md [&:has([data-open=true])]:border-border">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Logo />
        <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {!signedIn && (
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/login">Connexion</Link></Button>
          )}
          {primary}
          <Button
            ref={toggleRef}
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            data-open={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>
      {open && (
        <nav ref={menuRef} id="mobile-menu" aria-label="Navigation mobile" className="border-t bg-background px-5 pb-5 pt-2 md:hidden">
          <ul className="flex flex-col">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="flex h-12 items-center border-b text-base text-foreground">
                  {l.label}
                </Link>
              </li>
            ))}
            {!signedIn && (
              <li>
                <Link href="/login" onClick={() => setOpen(false)} className="flex h-12 items-center text-base text-muted-foreground">Connexion</Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
