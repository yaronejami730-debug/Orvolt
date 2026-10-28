"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CalendarDays, CheckSquare, ClipboardCheck, LayoutDashboard, LogOut, Menu, Route, Settings, Upload, Users, X, type LucideIcon } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { switchOrgAction } from "@/app/(app)/actions";
import { NotificationBell } from "@/components/app/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/marketing/logo";
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
  { href: "/confirmation", label: "Confirmation", icon: ClipboardCheck, dispatch: true },
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
    <div className="flex h-full flex-col bg-sidebar px-4 pb-2 pt-10 text-sidebar-foreground">
      <Logo href="/dashboard" onClick={onNavigate} tone="on-dark" className="mb-4 h-[52px]" />
      {props.orgs.length > 1 ? (
        <Select
          className="h-[38px] border-0 bg-transparent text-sm font-semibold text-sidebar-foreground shadow-none hover:bg-sidebar-hover hover:shadow-none focus-visible:shadow-none [&+svg]:text-sidebar-foreground"
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
        <p className="flex h-[38px] items-center justify-between truncate rounded-md px-2 text-sm font-semibold leading-5" title={props.orgName}>{props.orgName}</p>
      )}
      <nav aria-label="Navigation principale" className="mt-6 flex flex-1 flex-col">
        {items.map(({ href, label, icon: Icon }) => {
          const active = (pathname === href || pathname.startsWith(`${href}/`)) && !(href === "/agenda" && pathname.startsWith("/agenda/repartition"));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "grid h-9 grid-cols-[16px_1fr] items-center gap-3 rounded-md p-2 text-sm font-normal leading-5 text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-hover",
                active && "bg-sidebar-active font-semibold hover:bg-sidebar-active",
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh bg-sidebar lg:block">
        <SidebarContent props={props} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="Fermer le menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[240px] max-w-[85vw] bg-sidebar shadow-lg">
            <Button variant="ghost" size="icon" className="absolute right-2 top-2 text-sidebar-foreground hover:bg-sidebar-hover" aria-label="Fermer" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
            <SidebarContent props={props} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 bg-background px-4 lg:px-12">
          <div className="flex h-[55px] items-center gap-4 border-b">
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
          </div>
        </header>
        {props.banner}
        <main className="mx-auto w-full max-w-[1528px] flex-1 px-4 pb-24 pt-6 lg:px-16 lg:pb-24 lg:pt-6">{props.children}</main>
        <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
          {NAV.filter((n) => (!n.settings || props.showSettings) && (!n.import || props.showImport) && (!n.dispatch || props.showDispatch)).map(({ href, label, icon: Icon }) => {
            const active = (pathname === href || pathname.startsWith(`${href}/`)) && !(href === "/agenda" && pathname.startsWith("/agenda/repartition"));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                // Beaucoup d'entrées : la barre défile au lieu d'écraser les libellés ; l'entrée active reste visible.
                ref={(el) => { if (active && el) el.scrollIntoView({ inline: "center", block: "nearest" }); }}
                className={cn(
                  "flex min-w-[74px] flex-1 shrink-0 flex-col items-center gap-1 px-2 py-2 text-[11px] font-medium text-muted-foreground",
                  active && "font-semibold text-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="whitespace-nowrap">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
