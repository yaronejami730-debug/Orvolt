"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { landingAction, type LandingState } from "@/app/(lp)/lp/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SLOTS, SLOT_LABELS, campaignFromSearch, formatPhoneInput, isEmail, normalizePhone, type LeadKind, type Trade } from "@/lib/landing/fields";
import { SITE_NAME } from "@/lib/site";

type Errors = Record<string, string>;
const CONSENT_ERROR = "Merci d'accepter d'être rappelé pour continuer.";

/** Validation de confort côté navigateur (même règles que le serveur, qui reste l'autorité). */
function check(name: string, value: string): string {
  const v = value.trim();
  switch (name) {
    case "firstName": return v ? (v.length > 60 ? "Prénom trop long." : "") : "Prénom requis.";
    case "lastName": return v ? (v.length > 60 ? "Nom trop long." : "") : "Nom requis.";
    case "email": return v ? (isEmail(v) ? "" : "Adresse e-mail invalide.") : "Adresse e-mail requise.";
    case "phone": return v ? (normalizePhone(v).ok ? "" : "Numéro invalide. Exemples : 06 12 34 56 78 ou +33 6 12 34 56 78.") : "Numéro de téléphone requis.";
    default: return "";
  }
}

interface Props {
  kind: LeadKind;
  trade?: Trade;
  submitLabel: string;
  /** Micro-texte de réassurance sous le bouton (vrai : voir src/lib/landing/copy.ts). */
  hint: string;
  /** Chemin de la page (page d'entrée enregistrée avec le prospect). */
  path: string;
}

/**
 * Formulaire unique des pages d'acquisition : « essai » (nom, e-mail, téléphone) ou « rappel » (+ entreprise, créneau, consentement).
 * Attributs data-* prêts pour un futur pixel (Meta, Google Ads) : aucun script tiers n'est chargé ici. Un pixel devra être
 * ajouté avec le nonce de la CSP (src/lib/csp.ts, en-tête x-nonce) et déclenché sur l'évènement window « lp:lead ».
 */
export function LandingForm({ kind, trade, submitLabel, hint, path }: Props) {
  const [state, action, pending] = useActionState<LandingState, FormData>(landingAction, {});
  const v = state.fieldValues ?? {};
  const [errors, setErrors] = useState<Errors>({});
  const [phone, setPhone] = useState(v.phone ?? "");
  const [slot, setSlot] = useState(v.slot || "peu-importe");
  // Horodatage d'affichage (délai minimal côté serveur), campagne et référent : lus dans le navigateur, pages donc statiques.
  const [meta, setMeta] = useState({ startedAt: "", campaign: "{}", referrer: "" });
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    setMeta({ startedAt: String(Date.now()), campaign: JSON.stringify(campaignFromSearch(window.location.search)), referrer: document.referrer });
    // Autofocus du premier champ, sauf écran tactile (le clavier masquerait le titre et la promesse).
    if (!window.matchMedia("(pointer: coarse)").matches) formRef.current?.querySelector<HTMLInputElement>("input[name=firstName]")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (state.fieldErrors) {
      submitted.current = true;
      setErrors(state.fieldErrors);
      formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
    }
  }, [state]);

  useEffect(() => {
    if (state.ok) {
      doneRef.current?.focus();
      window.dispatchEvent(new CustomEvent("lp:lead", { detail: { kind, trade: trade ?? null, path } })); // point d'accroche d'un futur pixel
    }
  }, [state.ok, kind, trade, path]);

  const bad = (k: string) => ({ "aria-invalid": errors[k] ? (true as const) : undefined, "aria-describedby": errors[k] ? `${k}-error` : undefined });
  // Pas de validation à la sortie du champ : le message déplacerait le bouton entre « appui » et « relâchement » et le clic serait perdu.
  // Les erreurs apparaissent à l'envoi, puis se corrigent en direct pendant la saisie.
  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    const t = e.target as unknown as HTMLInputElement;
    if (!submitted.current || !(t.name in errors)) return;
    const m = t.name === "consent" ? (t.checked ? "" : CONSENT_ERROR) : check(t.name, t.value);
    setErrors((p) => ({ ...p, [t.name]: m }));
  };
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    submitted.current = true;
    const fd = new FormData(e.currentTarget);
    const next: Errors = {};
    for (const k of ["firstName", "lastName", "email", "phone"]) next[k] = check(k, String(fd.get(k) ?? ""));
    if (kind === "rappel" && fd.get("consent") !== "on") next.consent = CONSENT_ERROR;
    setErrors(next);
    const first = Object.keys(next).find((k) => next[k]);
    if (first) {
      e.preventDefault();
      e.currentTarget.querySelector<HTMLElement>(`[name=${first}]`)?.focus();
    }
  };

  if (state.ok) {
    return (
      <div role="status" className="py-4" data-testid="lp-success" data-track-event="Lead" data-track-kind={kind}>
        <CheckCircle2 className="size-10 text-success-text" aria-hidden />
        <h2 ref={doneRef} tabIndex={-1} className="mt-5 text-2xl font-semibold tracking-[-0.03em] outline-none">Merci, c&apos;est noté.</h2>
        <p className="mt-3 text-muted-foreground">Nous vous rappelons dans les meilleurs délais, sur le créneau choisi. Un e-mail de confirmation vient de vous être envoyé.</p>
        <p className="mt-6 text-muted-foreground">En attendant, vous pouvez déjà créer votre espace.</p>
        <Button asChild size="lg" className="mt-4 w-full sm:w-auto">
          <Link href="/signup" data-track-cta="start-trial">Démarrer l&apos;essai maintenant</Link>
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} onSubmit={onSubmit} onChange={onChange} noValidate className="space-y-5" data-testid="lp-form" data-track="lp-form" data-track-event="Lead" data-track-kind={kind} data-track-trade={trade ?? ""}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="trade" value={trade ?? ""} />
      <input type="hidden" name="landingPath" value={path} />
      <input type="hidden" name="startedAt" value={meta.startedAt} />
      <input type="hidden" name="campaign" value={meta.campaign} />
      <input type="hidden" name="referrer" value={meta.referrer} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">Prénom</Label>
          <Input id="firstName" name="firstName" autoComplete="given-name" autoCapitalize="words" enterKeyHint="next" required defaultValue={v.firstName} {...bad("firstName")} />
          <FieldError id="firstName-error" message={errors.firstName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Nom</Label>
          <Input id="lastName" name="lastName" autoComplete="family-name" autoCapitalize="words" enterKeyHint="next" required defaultValue={v.lastName} {...bad("lastName")} />
          <FieldError id="lastName-error" message={errors.lastName} />
        </div>
      </div>

      {kind === "rappel" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="phone">Téléphone</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" placeholder="06 12 34 56 78" required value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} {...bad("phone")} />
            <FieldError id="phone-error" message={errors.phone} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail professionnel</Label>
            <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required defaultValue={v.email} {...bad("email")} />
            <FieldError id="email-error" message={errors.email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Entreprise <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
            <Input id="company" name="company" autoComplete="organization" enterKeyHint="next" maxLength={120} defaultValue={v.company} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">Créneau de rappel souhaité</legend>
            <div className="flex flex-wrap gap-2 pt-1">
              {SLOTS.map((s) => (
                <span key={s}>
                  <input type="radio" id={`slot-${s}`} name="slot" value={s} checked={slot === s} onChange={() => setSlot(s)} className="peer sr-only" />
                  <label htmlFor={`slot-${s}`} className="inline-flex h-9 cursor-pointer items-center rounded-pill px-4 text-sm font-medium shadow-[inset_0_0_0_1px_var(--input)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--foreground)] peer-checked:bg-accent peer-checked:text-accent-foreground peer-checked:shadow-none peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground">{SLOT_LABELS[s]}</label>
                </span>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail professionnel</Label>
            <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required defaultValue={v.email} {...bad("email")} />
            <FieldError id="email-error" message={errors.email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Téléphone</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="go" placeholder="06 12 34 56 78" required value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} {...bad("phone")} />
            <FieldError id="phone-error" message={errors.phone} />
          </div>
        </>
      )}

      {/* Champ piège anti-robots : invisible pour un humain, ignoré par les lecteurs d'écran. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Site web<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      {kind === "rappel" && (
        <div className="space-y-2">
          <label className="flex items-start gap-3 text-sm text-muted-foreground">
            <input type="checkbox" name="consent" required defaultChecked={false} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" {...bad("consent")} />
            <span>J&apos;accepte d&apos;être rappelé(e) par {SITE_NAME} au sujet de ma demande. Mes données ne servent qu&apos;à cela, selon la <Link href="/confidentialite" target="_blank" rel="noopener" className="text-foreground underline underline-offset-2">politique de confidentialité</Link>.</span>
          </label>
          <FieldError id="consent-error" message={errors.consent} />
        </div>
      )}

      {state.error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive-text">{state.error}</p>}

      <div className="space-y-3 pt-1">
        <Button type="submit" size="lg" className="w-full" loading={pending} data-track-cta="submit">{submitLabel}</Button>
        <p className="text-center text-sm text-muted-foreground">{hint}</p>
        {kind === "essai" && <p className="text-center text-xs text-muted-foreground">En continuant, vous acceptez d&apos;être contacté au sujet de votre essai. Voir la <Link href="/confidentialite" target="_blank" rel="noopener" className="underline underline-offset-2">politique de confidentialité</Link>.</p>}
      </div>
    </form>
  );
}
