"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CalendarDays, CheckSquare, LayoutDashboard, LogOut, Menu, Route, Settings, Upload, Users, X, type LucideIcon } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { switchOrgAction } from "@/app/(app)/actions";
import { NotificationBell } from "@/components/app/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface ShellProps {
  orgName: string;
  orgId: string;
  orgs: { id: string; name: string }[];
  userName: string;
  userEmail: string;
  roleName: string;
  showSettings: boolean;
  showImport: boolean;
  showDispatch: boolean;
  banner?: React.ReactNode;
  children: React.ReactNode;
}

const NAV: { href: string; label: string; icon: LucideIcon; settings?: boolean; import?: boolean; dispatch?: boolean }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/agenda/repartition", label: "Répartition", icon: Route, dispatch: true },
  { href: "/tasks", label: "Tâches", icon: CheckSquare },
  { href: "/import", label: "Import", icon: Upload, import: true },
  { href: "/settings", label: "Paramètres", icon: Settings, settings: true },
];

function SidebarContent({ props, onNavigate }: { props: ShellProps; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const items = NAV.filter((n) => (!n.settings || props.showSettings) && (!n.import || props.showImport) && (!n.dispatch || props.showDispatch));
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/dashboard" onClick={onNavigate} className="px-2 text-lg font-semibold tracking-tight">
        Lead<span className="text-link">Forge</span>
      </Link>
      {props.orgs.length > 1 ? (
        <Select
          aria-label="Organisation"
          value={props.orgId}
          onChange={(e) =>
            start(async () => {
              await switchOrgAction(e.target.value);
              router.refresh();
            })
          }
        >
          {props.orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </Select>
      ) : (
        <p className="truncate rounded-md bg-muted px-3 py-2 text-sm font-medium" title={props.orgName}>{props.orgName}</p>
      )}
      <nav aria-label="Navigation principale" className="flex flex-1 flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = (pathname === href || pathname.startsWith(`${href}/`)) && !(href === "/agenda" && pathname.startsWith("/agenda/repartition"));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "bg-accent-soft text-link hover:bg-accent-soft hover:text-link",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell(props: ShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r bg-card lg:block">
        <SidebarContent props={props} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="Fermer le menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-card shadow-lg">
            <Button variant="ghost" size="icon" className="absolute right-2 top-2" aria-label="Fermer" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
            <SidebarContent props={props} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <div className="flex-1" />
          <NotificationBell />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Menu utilisateur" data-testid="user-menu" className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
                <Avatar name={props.userName || props.userEmail} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <span className="block text-sm font-medium">{props.userName}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{props.userEmail}</span>
                <Badge tone="accent" className="mt-2">{props.roleName}</Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => void logoutAction()}>
                <LogOut aria-hidden /> Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {props.banner}
        <main className="flex-1 p-[var(--space-page)] pb-24 lg:pb-[var(--space-page)]">{props.children}</main>
        <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {NAV.filter((n) => (!n.settings || props.showSettings) && (!n.import || props.showImport) && (!n.dispatch || props.showDispatch)).map(({ href, label, icon: Icon }) => {
            const active = (pathname === href || pathname.startsWith(`${href}/`)) && !(href === "/agenda" && pathname.startsWith("/agenda/repartition"));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium text-muted-foreground",
                  active && "text-link",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
