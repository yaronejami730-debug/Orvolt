"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setMemberStatusAction, updateMemberRoleAction } from "@/app/(app)/settings/members/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function MemberRoleSelect({
  membershipId,
  roleId,
  roles,
  lockedRoleIds = [],
  lockPlan = "Pro",
  disabled,
}: {
  membershipId: string;
  roleId: string;
  roles: { id: string; name: string }[];
  lockedRoleIds?: string[];
  lockPlan?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      aria-label="Rôle du membre"
      value={roleId}
      disabled={disabled || pending}
      className="h-9 min-w-36"
      onChange={(e) =>
        start(async () => {
          const res = await updateMemberRoleAction({ membershipId, roleId: e.target.value });
          if (res.ok) toast.success("Rôle mis à jour.");
          else toast.error(res.error);
        })
      }
    >
      {roles.map((r) => (
        // Le rôle actuel reste sélectionnable (membre existant après un downgrade) ; seules les nouvelles attributions sont grisées.
        <option key={r.id} value={r.id} disabled={lockedRoleIds.includes(r.id) && r.id !== roleId}>{r.name}{lockedRoleIds.includes(r.id) && r.id !== roleId ? ` (${lockPlan})` : ""}</option>
      ))}
    </Select>
  );
}

export function MemberStatusButton({ membershipId, active, disabled }: { membershipId: string; active: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={active ? "outline" : "secondary"}
      disabled={disabled}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await setMemberStatusAction({ membershipId, status: active ? "disabled" : "active" });
          if (res.ok) toast.success(active ? "Membre désactivé." : "Membre réactivé.");
          else toast.error(res.error);
        })
      }
    >
      {active ? "Désactiver" : "Réactiver"}
    </Button>
  );
}
