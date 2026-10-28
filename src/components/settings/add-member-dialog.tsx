"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Lock, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createMemberAction } from "@/app/(app)/settings/members/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DomainChecks } from "@/components/settings/member-call-programming";

export function AddMemberDialog({ roles, lockedRoleIds = [], lockPlan = "Pro", domains = [] }: { roles: { id: string; name: string }[]; lockedRoleIds?: string[]; lockPlan?: string; domains?: { id: string; name: string; color: string | null; active: boolean; position: number }[] }) {
  const [open, setOpen] = useState(false);
  const [domainIds, setDomainIds] = useState<string[]>([]);
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
      roleId: String(fd.get("roleId") ?? ""),
      ...(domainIds.length ? { domainIds } : {}),
    };
    start(async () => {
      const res = await createMemberAction(input);
      if (res.ok) {
        toast.success("Invitation envoyée.");
        setOpen(false);
        setDomainIds([]);
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
          <DialogDescription>La personne reçoit un e-mail avec un lien à usage unique pour choisir son mot de passe. Son compte n&apos;est utilisable qu&apos;après cette étape.</DialogDescription>
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
            <Label htmlFor="m-role">Rôle</Label>
            <Select id="m-role" name="roleId" required defaultValue={(roles.find((r) => r.name === "Commercial" && !lockedRoleIds.includes(r.id)) ?? roles.find((r) => !lockedRoleIds.includes(r.id)))?.id}>
              {roles.map((r) => (
                <option key={r.id} value={r.id} disabled={lockedRoleIds.includes(r.id)}>{r.name}{lockedRoleIds.includes(r.id) ? ` (${lockPlan})` : ""}</option>
              ))}
            </Select>
            {lockedRoleIds.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="roles-locked">
                <Lock className="size-3" aria-hidden /> Les rôles prospecteur, confirmateur, commercial et poseur sont disponibles avec le plan {lockPlan}.{" "}
                <Link href="/settings/billing" className="text-link underline-offset-2 hover:underline">Voir les formules</Link>
              </p>
            )}
          </div>
          {domains.length > 0 && (
            <div className="space-y-2">
              <Label>Domaine(s) de travail (facultatif)</Label>
              <DomainChecks domains={domains.filter((d) => d.active)} value={domainIds} onChange={setDomainIds} idPrefix="new-md" />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" loading={pending}>Envoyer l&apos;invitation</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
