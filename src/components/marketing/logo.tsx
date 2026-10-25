import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#2b59ff" />
      <path d="M11 8v13.5a1.5 1.5 0 0 0 1.5 1.5H22" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21.5" cy="11.5" r="2.2" fill="#fff" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="LeadForge, accueil" className={cn("inline-flex items-center gap-2.5 rounded-md font-semibold tracking-[-0.03em]", className)}>
      <LogoMark />
      <span className="text-[17px]">LeadForge</span>
    </Link>
  );
}
