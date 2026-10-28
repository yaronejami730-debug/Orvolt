"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, type ResetState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(forgotPasswordAction, {});
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>Mot de passe oublié</CardTitle>
        <CardDescription>Indiquez votre e-mail : nous vous envoyons un lien pour en choisir un nouveau.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.sent ? (
          <div className="space-y-4" role="status">
            <p className="text-sm">
              Si un compte existe pour <strong>{state.fieldValues?.email}</strong>, un e-mail vient de partir. Le lien est valable 1 heure.
            </p>
            <p className="text-sm text-muted-foreground">Rien reçu ? Vérifiez vos courriers indésirables.</p>
            <Link href="/login" className="block text-center text-sm text-link hover:underline">Retour à la connexion</Link>
          </div>
        ) : (
          <form action={action} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.fieldValues?.email} aria-invalid={state.fieldErrors?.email ? true : undefined} />
              <FieldError id="email-error" message={state.fieldErrors?.email} />
            </div>
            {state.error && !state.fieldErrors?.email && <p role="alert" className="text-sm text-destructive-text">{state.error}</p>}
            <Button type="submit" className="w-full" loading={pending}>Envoyer le lien</Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-link hover:underline">Retour à la connexion</Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
