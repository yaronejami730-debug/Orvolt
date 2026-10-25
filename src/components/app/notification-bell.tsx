"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { listNotificationsAction, markNotificationsReadAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ago } from "@/components/leads/format";

export function NotificationBell() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await listNotificationsAction()).data ?? { items: [], unread: 0 },
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;
  return (
    <DropdownMenu onOpenChange={(open) => { if (open && unread > 0) markNotificationsReadAction().then(() => setTimeout(() => qc.invalidateQueries({ queryKey: ["notifications"] }), 1500)); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications (${unread} non lues)` : "Notifications"} data-testid="bell">
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground" data-testid="bell-count">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(data?.items.length ?? 0) === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucune notification.</p>}
        <ul className="max-h-80 overflow-y-auto">
          {data?.items.map((n) => (
            <li key={n.id} className="border-b px-3 py-2 text-sm last:border-0">
              <p className={n.read_at ? "text-muted-foreground" : "font-medium"}>{String(n.payload.message ?? "Notification")}</p>
              <p className="text-xs text-muted-foreground">{n.payload.lead_name ? `${String(n.payload.lead_name)} · ` : ""}{ago(n.created_at)}</p>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
