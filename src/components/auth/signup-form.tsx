"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Building2, Check, CheckCircle2, Eye, EyeOff, HardHat, Headset, Info, Loader2, TriangleAlert } from "lucide-react";
import { sendSignupCodeAction, signupAction, verifySignupCodeAction, type FormState } from "@/app/(auth)/actions";
import { OnboardingSteps } from "@/components/onboarding/steps";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";
import { PLANS, TRIAL_DAYS, formatPrice, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { isValidSiret } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";

type Found = { name: string; address: string | null; active: boolean; legalForm: string | null; nafCode: string | null; leader: { firstName: string; lastName: string } | null };
type Lookup = { state: "idle" } | { state: "loading" } | ({ state: "found" } & Found) | { state: "manual"; reason: "not_found" | "unavailable" };
const FREE_MAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|orange|wanadoo|free|sfr|laposte|protonmail)\./i;
const KINDS = [
  { id: "installer", title: "Installateur", text: "Je réalise les chantiers", icon: HardHat },
  { id: "agency", title: "Régie", text: "Je génère et confirme des rendez-vous", icon: Headset },
] as const;

interface Props {
  prefill?: { email: string; firstName: string; lastName: string };
  /** Formule choisie sur le site (?plan=&interval=) : réaffichée ici et présélectionnée à l'étape suivante. */
  plan?: PlanId | null;
  interval?: BillingInterval;
  source?: string | null;
  /** La carte est demandée à l'étape 3 (facturation configurée) : le texte d'en-tête le dit honnêtement. */
  cardRequired?: boolean;
}

export function SignupForm({ prefill, plan = null, interval = "month", source = null, cardRequired = true }: Props = {}) {
  const [state, action, pending] = useActionState<FormState, FormData>(signupAction, {});
  const v = state.fieldValues ?? {};
  const fe = state.fieldErrors ?? {};
  // Tous les champs sont contrôlés : une erreur serveur ne fait perdre aucune saisie (mot de passe compris, qui ne repart jamais au serveur).
  const [siret, setSiret] = useState(v.siret ?? "");
  const [orgName, setOrgName] = useState(v.orgName ?? "");
  const [email, setEmail] = useState(v.email ?? prefill?.email ?? "");
  const [names, setNames] = useState({ first: v.firstName ?? prefill?.firstName ?? "", last: v.lastName ?? prefill?.lastName ?? "" });
  const [phone, setPhone] = useState(v.phone ?? "");
  const [kind, setKind] = useState(v.orgType ?? "");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  // Vérification de l'adresse : code à 6 chiffres envoyé automatiquement dès que l'adresse est valide ; le compte ne se crée qu'une fois l'adresse vérifiée.
  const [codeFor, setCodeFor] = useState<string | null>(null);      // adresse à laquelle un code a été envoyé
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mailPending, startMail] = useTransition();
  const requested = useRef(new Set<string>());                      // adresses déjà demandées (évite tout double envoi blur + clic)
  const codeRef = useRef<HTMLInputElement>(null);
  const siretRef = useRef<HTMLInputElement>(null);
  const mail = email.trim().toLowerCase();
  const mailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail);
  const verified = verifiedFor === mail;
  const meta = { plan: plan ?? undefined, interval, src: source ?? undefined };
  const sendCode = (force = false) => {
    if (!mailValid || (!force && requested.current.has(mail))) return;
    requested.current.add(mail);
    startMail(async () => {
      setCodeMsg(null);
      const r = await sendSignupCodeAction(mail, meta);
      if (r.ok) { setCodeFor(mail); setCode(""); setDevCode(r.devCode ?? null); setCodeMsg({ ok: true, text: `Code envoyé à ${mail} : consultez votre boîte e-mail (valable 10 minutes).` }); setTimeout(() => codeRef.current?.focus(), 50); }
      else { requested.current.delete(mail); setCodeMsg({ ok: false, text: r.error ?? "Envoi impossible." }); }
    });
  };
  const checkCode = (c: string) => startMail(async () => {
    const r = await verifySignupCodeAction(mail, c, meta);
    if (r.ok) { setVerifiedFor(mail); setCodeMsg(null); if (!siret) setTimeout(() => siretRef.current?.focus(), 50); } else setCodeMsg({ ok: false, text: r.error ?? "Code incorrect." });
  });
  // Le sixième chiffre valide tout seul (pas de bouton à chercher).
  useEffect(() => {
    if (code.length === 6 && codeFor === mail && !verified && !mailPending) checkCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  const nameEdited = useRef(!!v.orgName);
  const bad = (k: string) => ({ "aria-invalid": fe[k] ? true : undefined, "aria-describedby": fe[k] ? `${k}-error` : undefined });

  // Dès que le SIRET est complet et valide, on interroge l'API ; en cas d'échec, saisie manuelle.
  useEffect(() => {
    const clean = siret.replace(/\s/g, "");
    if (!isValidSiret(clean)) { setLookup({ state: "idle" }); return; }
    const ctl = new AbortController();
    setLookup({ state: "loading" });
    fetch(`/api/siret?siret=${clean}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { status: string; name?: string; address?: string | null; active?: boolean; legalForm?: string | null; nafCode?: string | null; leader?: { firstName?: string; lastName?: string } | null }) => {
        if (j.status === "found" && j.name) {
          const leader = j.leader?.firstName && j.leader.lastName ? { firstName: j.leader.firstName, lastName: j.leader.lastName } : null;
          setLookup({ state: "found", name: j.name, address: j.address ?? null, active: j.active !== false, legalForm: j.legalForm ?? null, nafCode: j.nafCode ?? null, leader });
          if (!nameEdited.current) setOrgName(j.name);
          // Dirigeant : prérempli seulement si les deux champs sont encore vides (jamais d'écrasement d'une saisie).
          if (leader) setNames((p) => (p.first.trim() || p.last.trim() ? p : { first: leader.firstName, last: leader.lastName }));
        } else setLookup({ state: "manual", reason: j.status === "not_found" ? "not_found" : "unavailable" });
      })
      .catch((e: unknown) => { if ((e as { name?: string }).name !== "AbortError") setLookup({ state: "manual", reason: "unavailable" }); });
    return () => ctl.abort();
  }, [siret]);

  const chosen = plan ? PLANS[plan] : null;
  const sentHere = codeFor === mail;

  return (
    <div className="space-y-4">
      <OnboardingSteps current={1} />
      <Card>
        <CardHeader>
          <CardTitle>Créez votre compte</CardTitle>
          <CardDescription>
            {TRIAL_DAYS} jours d&apos;essai gratuit, annulation en un clic.{" "}
            {cardRequired ? `À l'étape 3, une carte est demandée chez Stripe pour lancer l'essai : rien n'est prélevé avant la fin des ${TRIAL_DAYS} jours.` : ""}
          </CardDescription>
          {chosen && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-accent-soft px-3 py-2 text-sm" data-testid="signup-plan">
              <span>Formule choisie : <strong>{chosen.name}</strong> · {formatPrice(interval === "year" ? chosen.yearlyPriceCents : chosen.priceCents)} {interval === "year" ? "par an" : "par mois"}, après l&apos;essai.</span>
              <Link href="/pricing" className="text-link underline underline-offset-2">Changer</Link>
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-5" noValidate>
            <input type="hidden" name="plan" value={plan ?? ""} />
            <input type="hidden" name="interval" value={interval} />
            <input type="hidden" name="src" value={source ?? ""} />
            <input type="hidden" name="orgType" value={kind} />

            <div className="space-y-2">
              <Label htmlFor="email">E-mail professionnel</Label>
              <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoFocus={!prefill?.email} enterKeyHint="next" required value={email}
                onChange={(e) => setEmail(e.target.value)} onBlur={() => sendCode()} {...bad("email")} />
              <FieldError id="email-error" message={fe.email} />
              {FREE_MAIL.test(email) && !fe.email && <p className="text-xs text-muted-foreground" data-testid="free-mail-hint">Une adresse à votre nom de domaine (ex. prenom@votre-entreprise.fr) est préférable.</p>}
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="email-verification" aria-live="polite">
              {verified ? (
                <p className="flex items-center gap-2 text-sm text-success-text" data-testid="email-verified"><CheckCircle2 className="size-4" aria-hidden />Adresse e-mail vérifiée : {mail}</p>
              ) : (
                <>
                  {!sentHere && <p className="text-sm text-muted-foreground">Nous vous envoyons un code à 6 chiffres pour vérifier votre adresse : il part dès que vous quittez ce champ.</p>}
                  <div className="flex flex-wrap items-end gap-3">
                    {!sentHere && <Button type="button" variant="outline" size="sm" loading={mailPending} disabled={!mailValid || mailPending} onClick={() => sendCode()}>Envoyer le code</Button>}
                    {sentHere && (
                      <div className="space-y-2.5">
                        <Label htmlFor="emailCode" className="block">Code à 6 chiffres</Label>
                        <div className="flex items-center gap-3">
                          <Input ref={codeRef} id="emailCode" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} className="w-36 tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                          {mailPending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Vérification en cours" />}
                          <Button type="button" variant="ghost" size="sm" disabled={mailPending} onClick={() => sendCode(true)}>Renvoyer le code</Button>
                        </div>
                      </div>
                    )}
                  </div>
                  {codeMsg && <p role={codeMsg.ok ? "status" : "alert"} className={codeMsg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive-text"} data-testid="email-code-msg">{codeMsg.text}</p>}
                  {devCode && <p className="rounded bg-warning/15 px-2 py-1 text-xs" data-testid="dev-code">Mode développement (aucun e-mail réel) : code {devCode}</p>}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="siret">N° de SIRET</Label>
              <Input ref={siretRef} id="siret" name="siret" inputMode="numeric" pattern="[0-9 ]*" autoComplete="off" enterKeyHint="next" placeholder="14 chiffres" required value={siret} onChange={(e) => setSiret(e.target.value)} {...bad("siret")} />
              <FieldError id="siret-error" message={fe.siret} />
              <div aria-live="polite" className="min-h-5 text-sm" data-testid="siret-status" data-state={lookup.state === "manual" ? lookup.reason : lookup.state}>
                {lookup.state === "loading" && <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Recherche de l&apos;entreprise…</span>}
                {lookup.state === "found" && (
                  <div className={`mt-1 flex items-start gap-3 rounded-lg border p-3 ${lookup.active ? "bg-success-soft" : "bg-warning/15"}`} data-testid="siret-card">
                    <Building2 className="mt-0.5 size-5 shrink-0 text-foreground/70" aria-hidden />
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-foreground"><span className="break-words">{lookup.name}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${lookup.active ? "text-success-text" : "text-foreground"}`}>
                          {lookup.active ? <CheckCircle2 className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}{lookup.active ? "Entreprise reconnue · active" : "Établissement fermé"}
                        </span></p>
                      {lookup.address && <p className="text-muted-foreground">{lookup.address}</p>}
                      {(lookup.legalForm || lookup.nafCode) && <p className="text-muted-foreground">{[lookup.legalForm, lookup.nafCode ? `Activité (NAF) ${lookup.nafCode}` : null].filter(Boolean).join(" · ")}</p>}
                      {!lookup.active && <p className="text-foreground">Cet établissement est déclaré fermé : vous pouvez tout de même créer votre espace.</p>}
                      <p className="text-xs text-muted-foreground">Les champs ci-dessous sont préremplis{lookup.leader ? " (y compris le dirigeant)" : ""} : vous pouvez les modifier.</p>
                    </div>
                  </div>
                )}
                {lookup.state === "manual" && <span className="inline-flex items-start gap-1.5 text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{lookup.reason === "not_found" ? "SIRET non reconnu : vous pouvez continuer en saisissant le nom de votre entreprise." : "Vérification indisponible : saisissez le nom de votre entreprise."}</span>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="orgName">Nom de l&apos;entreprise</Label>
              <Input id="orgName" name="orgName" autoComplete="organization" enterKeyHint="next" required value={orgName} onChange={(e) => { nameEdited.current = true; setOrgName(e.target.value); }} {...bad("orgName")} />
              <FieldError id="orgName-error" message={fe.orgName} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom</Label>
                <Input id="firstName" name="firstName" autoComplete="given-name" enterKeyHint="next" required value={names.first} onChange={(e) => setNames((p) => ({ ...p, first: e.target.value }))} {...bad("firstName")} />
                <FieldError id="firstName-error" message={fe.firstName} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nom</Label>
                <Input id="lastName" name="lastName" autoComplete="family-name" enterKeyHint="next" required value={names.last} onChange={(e) => setNames((p) => ({ ...p, last: e.target.value }))} {...bad("lastName")} />
                <FieldError id="lastName-error" message={fe.lastName} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
              <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" value={phone} onChange={(e) => setPhone(e.target.value)} {...bad("phone")} />
              <FieldError id="phone-error" message={fe.phone} />
            </div>

            <fieldset className="space-y-2" data-testid="q-orgType">
              <legend className="text-sm font-medium">Votre activité</legend>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Votre activité">
                {KINDS.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={kind === c.id} data-testid={`kind-${c.id}`} onClick={() => setKind(c.id)}
                    className={cn("relative flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-muted-foreground/60", kind === c.id && "border-accent bg-accent-soft")}>
                    <c.icon className="size-5 shrink-0 text-link" aria-hidden />
                    <span className="min-w-0"><span className="block text-sm font-medium">{c.title}</span><span className="block text-xs text-muted-foreground">{c.text}</span></span>
                    {kind === c.id && <Check className="absolute right-3 top-3 size-4 text-link" aria-hidden />}
                  </button>
                ))}
              </div>
              <FieldError id="orgType-error" message={fe.orgType} />
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input id="password" name="password" type={showPwd ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={72} enterKeyHint="go" required className="pr-11" value={password} onChange={(e) => setPassword(e.target.value)} {...bad("password")} />
                <button type="button" onClick={() => setShowPwd((s) => !s)} aria-label={showPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"} aria-pressed={showPwd} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">8 caractères minimum.</p>
              <FieldError id="password-error" message={fe.password} />
            </div>

            {state.error && !Object.keys(fe).length && <p role="alert" className="text-sm text-destructive-text">{state.error}</p>}
            <Button type="submit" className="w-full" size="lg" loading={pending} disabled={!verified}>{plan ? "Créer mon compte et choisir la formule" : "Créer mon compte"}</Button>
            {!verified && <p className="text-center text-xs text-muted-foreground">Le bouton s&apos;active dès que votre adresse e-mail est vérifiée.</p>}
            <p className="text-center text-xs text-muted-foreground">En créant votre compte, vous acceptez nos <Link href="/cgv" className="underline underline-offset-2">CGV</Link> et notre <Link href="/confidentialite" className="underline underline-offset-2">politique de confidentialité</Link>.</p>
            <p className="text-center text-sm text-muted-foreground">
              Déjà inscrit ? <Link href="/login" className="text-link hover:underline">Se connecter</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
