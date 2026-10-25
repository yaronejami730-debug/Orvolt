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
  disabled,
}: {
  membershipId: string;
  roleId: string;
  roles: { id: string; name: string }[];
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
        <option key={r.id} value={r.id}>{r.name}</option>
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
