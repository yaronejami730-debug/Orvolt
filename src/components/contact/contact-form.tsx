"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { contactAction, type ContactState } from "@/app/(landing)/contact/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [state, action, pending] = useActionState<ContactState, FormData>(contactAction, {});
  const v = state.fieldValues ?? {};
  const fe = state.fieldErrors ?? {};
  const bad = (k: string) => ({ "aria-invalid": fe[k] ? true : undefined, "aria-describedby": fe[k] ? `${k}-error` : undefined });

  if (state.ok) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-10 text-center" data-testid="contact-success">
        <CheckCircle2 className="size-12 text-link" aria-hidden />
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">Merci, c&apos;est bien reçu.</h2>
        <p className="max-w-sm text-muted-foreground">Un conseiller vous recontacte très vite pour échanger sur votre activité.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Votre nom</Label>
          <Input id="name" name="name" autoComplete="name" required defaultValue={v.name} {...bad("name")} />
          <FieldError id="name-error" message={fe.name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company">Entreprise <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
          <Input id="company" name="company" autoComplete="organization" defaultValue={v.company} {...bad("company")} />
          <FieldError id="company-error" message={fe.company} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Téléphone</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" required defaultValue={v.phone} {...bad("phone")} />
          <FieldError id="phone-error" message={fe.phone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={v.email} {...bad("email")} />
          <FieldError id="email-error" message={fe.email} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="message">Votre besoin <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
        <Textarea id="message" name="message" rows={4} maxLength={1000} defaultValue={v.message} placeholder="Taille de l'équipe, métier, ce que vous cherchez à améliorer…" {...bad("message")} />
        <FieldError id="message-error" message={fe.message} />
      </div>

      {/* Champ piège anti-robots : invisible pour un humain. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Site web<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input type="checkbox" name="consent" required className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" aria-invalid={fe.consent ? true : undefined} aria-describedby={fe.consent ? "consent-error" : undefined} />
          <span>J&apos;accepte d&apos;être recontacté au sujet de ma demande. Mes données ne servent qu&apos;à cela.</span>
        </label>
        <FieldError id="consent-error" message={fe.consent} />
      </div>

      {state.error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{state.error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={pending}>Être recontacté</Button>
    </form>
  );
}
