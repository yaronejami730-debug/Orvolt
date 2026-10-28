"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>Connexion</CardTitle>
        <CardDescription>Retrouvez vos leads et votre équipe.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.fieldValues?.email} aria-invalid={state.fieldErrors?.email ? true : undefined} />
            <FieldError id="email-error" message={state.fieldErrors?.email} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Mot de passe</Label>
              <Link href="/forgot" className="text-sm text-link hover:underline">Mot de passe oublié ?</Link>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {state.error && !state.fieldErrors?.email && <p role="alert" className="text-sm text-destructive-text">{state.error}</p>}
          <Button type="submit" className="w-full" loading={pending}>Se connecter</Button>
          <p className="text-center text-sm text-muted-foreground">
            Pas encore de compte ? <Link href="/signup" className="text-link hover:underline">Créer mon espace</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
