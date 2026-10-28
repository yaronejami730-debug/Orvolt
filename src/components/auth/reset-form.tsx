"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction, type ResetState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";

export function ResetForm({ tokenHash, invite = false }: { tokenHash: string; invite?: boolean }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPasswordAction, {});
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{invite ? "Choisir mon mot de passe" : "Nouveau mot de passe"}</CardTitle>
        <CardDescription>Choisissez un mot de passe d&apos;au moins 8 caractères.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <div className="space-y-2">
            <Label htmlFor="password">Nouveau mot de passe</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={state.fieldErrors?.password ? true : undefined} />
            <FieldError id="password-error" message={state.fieldErrors?.password} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmer le mot de passe</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={state.fieldErrors?.confirm ? true : undefined} />
            <FieldError id="confirm-error" message={state.fieldErrors?.confirm} />
          </div>
          {state.error && !state.fieldErrors?.password && !state.fieldErrors?.confirm && (
            <p role="alert" className="text-sm text-destructive-text">
              {state.error} <Link href="/forgot" className="text-link hover:underline">Nouveau lien</Link>
            </p>
          )}
          <Button type="submit" className="w-full" loading={pending}>{invite ? "Activer mon compte" : "Enregistrer et me connecter"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
