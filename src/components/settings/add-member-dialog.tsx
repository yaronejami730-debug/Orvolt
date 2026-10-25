"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createMemberAction } from "@/app/(app)/settings/members/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function AddMemberDialog({ roles }: { roles: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [fe, setFe] = useState<Record<string, string>>({});
  const bad = (k: string) => ({ "aria-invalid": fe[k] ? true : undefined, "aria-describedby": fe[k] ? `${k}-error` : undefined });
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      fullName: String(fd.get("fullName") ?? ""),
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      roleId: String(fd.get("roleId") ?? ""),
    };
    start(async () => {
      const res = await createMemberAction(input);
      if (res.ok) {
        toast.success("Membre ajouté.");
        setOpen(false);
        setError(undefined);
        setFe({});
      } else {
        setFe(res.fieldErrors ?? {});
        setError(res.fieldErrors ? undefined : res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus className="size-4" /> Ajouter un membre</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un membre</DialogTitle>
          <DialogDescription>Créez un compte avec un mot de passe temporaire à transmettre à la personne.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="m-name">Nom complet</Label>
            <Input id="m-name" name="fullName" {...bad("fullName")} required />
            <FieldError id="fullName-error" message={fe.fullName} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-email">E-mail</Label>
            <Input id="m-email" name="email" {...bad("email")} type="email" required />
            <FieldError id="email-error" message={fe.email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-pass">Mot de passe temporaire</Label>
            <Input id="m-pass" name="password" {...bad("password")} type="text" autoComplete="off" minLength={8} required />
            <FieldError id="password-error" message={fe.password} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-role">Rôle</Label>
            <Select id="m-role" name="roleId" required defaultValue={roles.find((r) => r.name === "Commercial")?.id ?? roles[0]?.id}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" loading={pending}>Créer le membre</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
