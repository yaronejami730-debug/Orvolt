"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { signupAction, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";
import { AVAILABLE_TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";

export function SignupForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signupAction, {});
  const [template, setTemplate] = useState(state.fieldValues?.template || "energie");
  const [password, setPassword] = useState("");
  const v = state.fieldValues ?? {};
  const fe = state.fieldErrors ?? {};
  const bad = (k: string) => ({ "aria-invalid": fe[k] ? true : undefined, "aria-describedby": fe[k] ? `${k}-error` : undefined });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Créer mon espace</CardTitle>
        <CardDescription>Essai gratuit 14 jours · annulation en un clic.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">Votre nom</Label>
              <Input id="fullName" name="fullName" autoComplete="name" required defaultValue={v.fullName} {...bad("fullName")} />
              <FieldError id="fullName-error" message={fe.fullName} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgName">Nom de l&apos;entreprise</Label>
              <Input id="orgName" name="orgName" autoComplete="organization" required defaultValue={v.orgName} {...bad("orgName")} />
              <FieldError id="orgName-error" message={fe.orgName} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={v.email} {...bad("email")} />
              <FieldError id="email-error" message={fe.email} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} {...bad("password")} />
              <FieldError id="password-error" message={fe.password} />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Votre métier</legend>
            <FieldError id="template-error" message={fe.template} />
            <input type="hidden" name="template" value={template} />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Métier">
              {AVAILABLE_TEMPLATES.map((t) => {
                const selected = template === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`template-${t.id}`}
                    onClick={() => setTemplate(t.id)}
                    className={cn(
                      "relative rounded-lg border bg-card p-3 text-left transition-colors hover:border-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-ring",
                      selected && "border-accent bg-accent-soft",
                    )}
                  >
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{t.description}</span>
                    {selected && <Check className="absolute right-2 top-2 size-4 text-link" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {state.error && !Object.keys(fe).length && <p role="alert" className="text-sm text-destructive-text">{state.error}</p>}
          <Button type="submit" className="w-full" size="lg" loading={pending}>Créer mon espace</Button>
          <p className="text-center text-sm text-muted-foreground">
            Déjà inscrit ? <Link href="/login" className="text-link hover:underline">Se connecter</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
