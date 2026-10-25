import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <Link href="/" className="mb-8 text-xl font-semibold tracking-tight">
        Lead<span className="text-link">Forge</span>
      </Link>
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}
