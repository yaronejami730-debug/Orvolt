"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteRoleAction, saveRoleAction } from "@/app/(app)/settings/roles/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PERMISSION_GROUPS, PERMISSION_LABELS, type Permission } from "@/lib/permissions";

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_admin: boolean;
  system_key?: string | null;
  permissions: Permission[];
}

/** `allowed` : permissions que l'utilisateur peut accorder (anti-escalade). Les autres cases sont en lecture seule. */
export function RoleEditor({ role, allowed }: { role?: RoleView; allowed?: readonly Permission[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Permission[]>(role?.permissions ?? []);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const locked = (p: Permission) => allowed !== undefined && !allowed.includes(p);

  function toggle(p: Permission, on: boolean) {
    if (on && allowed && !allowed.includes(p)) return;
    setPerms((cur) => (on ? [...cur, p] : cur.filter((x) => x !== p)));
  }

  function save() {
    start(async () => {
      const res = await saveRoleAction({ id: role?.id, name, description, permissions: perms });
      if (res.ok) {
        toast.success(role ? "Rôle mis à jour." : "Rôle créé.");
        setOpen(false);
        setError(undefined);
        if (!role) {
          setName("");
          setDescription("");
          setPerms([]);
        }
      } else setError(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {role ? (
          <Button size="sm" variant="outline" aria-label={`Modifier ${role.name}`}><Pencil className="size-3.5" /> Modifier</Button>
        ) : (
          <Button><Plus className="size-4" /> Nouveau rôle</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? `Modifier « ${role.name} »` : "Nouveau rôle"}</DialogTitle>
          <DialogDescription>
            Cochez les actions autorisées pour ce rôle.{allowed && " Les cases grisées dépassent vos propres droits : seul le super administrateur peut les accorder."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="r-name">Nom</Label>
              <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} disabled={role?.is_system} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-desc">Description</Label>
              <Input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {PERMISSION_GROUPS.map((g) => (
              <fieldset key={g.label} className="space-y-2 rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</legend>
                {g.permissions.map((p) => (
                  <div key={p} className="flex items-center gap-2">
                    <Checkbox id={`p-${p}`} checked={perms.includes(p)} disabled={locked(p) && !perms.includes(p)} onCheckedChange={(v) => toggle(p, v === true)} />
                    <Label htmlFor={`p-${p}`} className={`font-normal ${locked(p) && !perms.includes(p) ? "text-muted-foreground" : "cursor-pointer"}`}>{PERMISSION_LABELS[p]}</Label>
                  </div>
                ))}
              </fieldset>
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={save} loading={pending}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRoleButton({ role }: { role: RoleView }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Supprimer ${role.name}`}
      loading={pending}
      onClick={() => {
        if (!window.confirm(`Supprimer le rôle « ${role.name} » ?`)) return;
        start(async () => {
          const res = await deleteRoleAction({ id: role.id });
          if (res.ok) toast.success("Rôle supprimé.");
          else toast.error(res.error);
        });
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
