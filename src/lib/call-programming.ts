import { z } from "zod";
import { PALETTE_VALUES } from "@/lib/colors";

/**
 * Programmation des formulaires d'appel : quel formulaire pour quel téléprospecteur, quel domaine, et à quel moment.
 * Logique pure, partagée écrans / serveur / tests. Miroir exact de la fonction SQL call_scripts_resolve
 * (supabase/migrations/20260212000001_call_scripts_resolution.sql).
 */
export const PROGRAMMING_TZ = "Europe/Paris";

/** Plafonds (mêmes valeurs que les triggers SQL). */
export const MAX_DOMAINS = 30;
export const MAX_DOMAINS_PER_MEMBER = 10;
export const MAX_ASSIGNMENTS = 300;
export const MAX_ASSIGNMENTS_PER_SCRIPT = 40;

export interface CallDomain { id: string; name: string; color: string | null; active: boolean; position: number }
export interface ScriptLite { id: string; name: string; active: boolean; domainId: string | null; position: number }

export const SCOPES = ["member", "domain", "all"] as const;
export type AssignmentScope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<AssignmentScope, string> = { member: "Un téléprospecteur", domain: "Tous les membres d'un domaine", all: "Tout le monde" };

export interface Assignment {
  id: string;
  scriptId: string;
  scope: AssignmentScope;
  userId: string | null;
  domainId: string | null;
  /** Jours locaux (Europe/Paris) AAAA-MM-JJ, inclus. */
  startsOn: string | null;
  endsOn: string | null;
  /** Jours ISO : 1 = lundi … 7 = dimanche ; null = tous. */
  days: number[] | null;
  /** Plage horaire locale HH:MM, [from, to[ ; null = toute la journée. */
  timeFrom: string | null;
  timeTo: string | null;
  active: boolean;
  priority: number;
}

export interface MemberInfo { userId: string; domainIds: string[] }
export type ResolveReason = "lead_domain" | "member_domain" | "generic" | "other";
export interface ResolvedScript { scriptId: string; name: string; domainId: string | null; rank: number; isDefault: boolean; reason: ResolveReason; assignmentId: string | null }
export interface ResolveInput {
  member: MemberInfo;
  domains: CallDomain[];
  assignments: Assignment[];
  scripts: ScriptLite[];
  lead?: { domainId: string | null } | null;
  now: Date;
  /** Fonction « Pro et au-dessus » active ? Sinon (Starter) tous les formulaires actifs restent ouverts à tous. */
  programming?: boolean;
  /** Gérant / administrateur : voit tous les formulaires actifs (ordre inchangé). */
  seeAll?: boolean;
}
export interface Resolution { scripts: ResolvedScript[]; defaultScript: ResolvedScript | null }

// ---------------------------------------------------------------- heure locale (Europe/Paris, changement d'heure inclus)
const ISO_DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: PROGRAMMING_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });

export interface LocalParts { date: string; seconds: number; dow: number }
/** Date, heure (en secondes depuis minuit) et jour ISO à Paris pour un instant donné. */
export function localParts(at: Date): LocalParts {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(at)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, seconds: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second), dow: ISO_DOW[p.weekday] ?? 1 };
}
const toSeconds = (t: string) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + (m || 0) * 60 + (s || 0); };

/** La fenêtre de l'affectation couvre-t-elle cet instant (période, jour de la semaine, plage horaire) ? */
export function windowCovers(a: Pick<Assignment, "startsOn" | "endsOn" | "days" | "timeFrom" | "timeTo">, at: Date): boolean {
  const l = localParts(at);
  if (a.startsOn && l.date < a.startsOn) return false;
  if (a.endsOn && l.date > a.endsOn) return false;
  if (a.days && !a.days.includes(l.dow)) return false;
  if (a.timeFrom && a.timeTo && !(l.seconds >= toSeconds(a.timeFrom) && l.seconds < toSeconds(a.timeTo))) return false;
  return true;
}

// ---------------------------------------------------------------- résolution
const SPEC: Record<AssignmentScope, number> = { member: 0, domain: 1, all: 2 };

/**
 * Formulaires applicables à un membre, du plus pertinent au moins pertinent ; le premier est le formulaire par défaut.
 * Un formulaire n'apparaît que s'il est actif ET (jamais programmé, comme avant la fonction) OU affecté au membre
 * (directement, via un de ses domaines, ou à tout le monde) dans sa fenêtre temporelle.
 * Ordre : domaine du lead, puis domaine du membre, puis générique, puis le reste ; ensuite priorité, spécificité, position, nom.
 */
export function resolveScriptsForMember(input: ResolveInput): Resolution {
  const { member, domains, assignments, scripts, lead, now } = input;
  const all = input.seeAll === true || input.programming === false;
  const activeDomains = new Set(domains.filter((d) => d.active).map((d) => d.id));
  const memberDomains = new Set(member.domainIds.filter((d) => activeDomains.has(d)));
  const leadDomain = lead?.domainId && activeDomains.has(lead.domainId) ? lead.domainId : null;
  const bySript = new Map<string, Assignment[]>();
  for (const a of assignments) bySript.set(a.scriptId, [...(bySript.get(a.scriptId) ?? []), a]);

  const rows: { s: ScriptLite; prio: number; spec: number; aid: string | null; grp: number }[] = [];
  for (const s of scripts) {
    if (!s.active) continue;
    const own = bySript.get(s.id) ?? [];
    let best: { prio: number; spec: number; aid: string | null } | null = null;
    if (all) best = { prio: 0, spec: 3, aid: own[0]?.id ?? null };
    else if (own.length === 0) best = { prio: -1, spec: 3, aid: null }; // jamais programmé : ouvert à tous
    else {
      for (const a of own) {
        if (!a.active) continue;
        const target = a.scope === "all" || (a.scope === "member" && a.userId === member.userId) || (a.scope === "domain" && !!a.domainId && memberDomains.has(a.domainId));
        if (!target || !windowCovers(a, now)) continue;
        const cand = { prio: a.priority, spec: SPEC[a.scope], aid: a.id };
        if (!best || cand.prio > best.prio || (cand.prio === best.prio && cand.spec < best.spec) || (cand.prio === best.prio && cand.spec === best.spec && cand.aid! < best.aid!)) best = cand;
      }
    }
    if (!best) continue;
    const grp = s.domainId && s.domainId === leadDomain ? 0 : s.domainId && memberDomains.has(s.domainId) ? 1 : !s.domainId ? 2 : 3;
    rows.push({ s, ...best, grp });
  }
  rows.sort((x, y) => x.grp - y.grp || y.prio - x.prio || x.spec - y.spec || x.s.position - y.s.position || (x.s.name < y.s.name ? -1 : x.s.name > y.s.name ? 1 : 0) || (x.s.id < y.s.id ? -1 : 1));
  const reasons: ResolveReason[] = ["lead_domain", "member_domain", "generic", "other"];
  const out = rows.map((r, i): ResolvedScript => ({ scriptId: r.s.id, name: r.s.name, domainId: r.s.domainId, rank: i + 1, isDefault: i === 0, reason: reasons[r.grp], assignmentId: r.aid }));
  return { scripts: out, defaultScript: out[0] ?? null };
}

// ---------------------------------------------------------------- validation (formulaire de programmation)
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.").refine((d) => !Number.isNaN(Date.parse(d)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Date invalide.");
const colorSchema = z.string().refine((c) => PALETTE_VALUES.includes(c), "Couleur invalide.");
const blank = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" || v === undefined ? null : v), t.nullable());

export const domainInputSchema = z.object({
  id: z.uuid().nullish(),
  name: z.string().trim().min(1, "Donnez un nom au domaine.").max(60, "60 caractères au maximum."),
  color: colorSchema.nullish(),
  active: z.boolean().optional(),
});
export const idInput = z.object({ id: z.uuid() });
export const memberDomainsInputSchema = z.object({
  userId: z.uuid(),
  domainIds: z.array(z.uuid()).max(MAX_DOMAINS_PER_MEMBER, `${MAX_DOMAINS_PER_MEMBER} domaines au maximum par membre.`).refine((a) => new Set(a).size === a.length, "Domaine en double."),
});

export const assignmentInputSchema = z.object({
  id: z.uuid().nullish(),
  scriptId: z.uuid({ message: "Choisissez un formulaire." }),
  scope: z.enum(SCOPES),
  userId: blank(z.uuid()).optional(),
  domainId: blank(z.uuid()).optional(),
  startsOn: blank(day).optional(),
  endsOn: blank(day).optional(),
  days: z.array(z.number().int().min(1).max(7)).max(7).nullish(),
  timeFrom: blank(z.string().regex(hhmm, "Heure invalide.")).optional(),
  timeTo: blank(z.string().regex(hhmm, "Heure invalide.")).optional(),
  active: z.boolean().default(true),
  priority: z.number().int("La priorité est un nombre entier.").min(0, "Priorité de 0 à 100.").max(100, "Priorité de 0 à 100.").default(0),
}).superRefine((a, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (a.scope === "member" && !a.userId) bad("userId", "Choisissez un téléprospecteur.");
  if (a.scope === "domain" && !a.domainId) bad("domainId", "Choisissez un domaine.");
  if (a.scope !== "member" && a.userId) bad("userId", "Un téléprospecteur n'a de sens que pour « Un téléprospecteur ».");
  if (a.scope !== "domain" && a.domainId) bad("domainId", "Un domaine n'a de sens que pour « Tous les membres d'un domaine ».");
  if (a.startsOn && a.endsOn && a.endsOn < a.startsOn) bad("endsOn", "La date de fin précède la date de début.");
  if (!a.timeFrom !== !a.timeTo) bad("timeTo", "Indiquez l'heure de début ET l'heure de fin.");
  if (a.timeFrom && a.timeTo && a.timeFrom >= a.timeTo) bad("timeTo", "L'heure de fin doit suivre l'heure de début (pour une plage de nuit, créez deux programmations).");
  if (a.days && new Set(a.days).size !== a.days.length) bad("days", "Jour en double.");
});
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

/** Forme normalisée d'une saisie (jours triés, tableaux vides = tous, valeurs nulles explicites). */
export function normalizeAssignment(a: AssignmentInput): Omit<Assignment, "id"> {
  const days = a.days && a.days.length > 0 && a.days.length < 7 ? [...new Set(a.days)].sort((x, y) => x - y) : null;
  return {
    scriptId: a.scriptId, scope: a.scope,
    userId: a.scope === "member" ? (a.userId ?? null) : null, domainId: a.scope === "domain" ? (a.domainId ?? null) : null,
    startsOn: a.startsOn ?? null, endsOn: a.endsOn ?? null, days, timeFrom: a.timeFrom ?? null, timeTo: a.timeTo ?? null, active: a.active, priority: a.priority,
  };
}

const sameWindow = (a: Omit<Assignment, "id">, b: Omit<Assignment, "id">) =>
  a.startsOn === b.startsOn && a.endsOn === b.endsOn && a.timeFrom === b.timeFrom && a.timeTo === b.timeTo && (a.days ?? []).join() === (b.days ?? []).join();

/** Doublon exact : même formulaire, même cible, mêmes fenêtres. */
export function isDuplicate(candidate: Omit<Assignment, "id">, existing: Assignment[], ignoreId?: string | null): boolean {
  return existing.some((e) => e.id !== ignoreId && e.scriptId === candidate.scriptId && e.scope === candidate.scope && e.userId === candidate.userId && e.domainId === candidate.domainId && sameWindow(e, candidate));
}

const rangesOverlap = (a1: string | null, a2: string | null, b1: string | null, b2: string | null) => (a2 === null || b1 === null || b1 <= a2) && (b2 === null || a1 === null || a1 <= b2);
/** Deux programmations se recouvrent-elles dans le temps (période, jours, plage horaire) ? */
export function windowsOverlap(a: Omit<Assignment, "id">, b: Omit<Assignment, "id">): boolean {
  if (!rangesOverlap(a.startsOn, a.endsOn, b.startsOn, b.endsOn)) return false;
  if (a.days && b.days && !a.days.some((d) => b.days!.includes(d))) return false;
  if (a.timeFrom && a.timeTo && b.timeFrom && b.timeTo && !(a.timeFrom < b.timeTo && b.timeFrom < a.timeTo)) return false;
  return true;
}

/**
 * Chevauchements AMBIGUS : même cible, formulaires différents, tous deux actifs, même priorité et fenêtres qui se recouvrent.
 * (Avec des priorités différentes, la plus haute tranche : pas d'ambiguïté.)
 */
export function findAmbiguousOverlaps(candidate: Omit<Assignment, "id">, existing: Assignment[], ignoreId?: string | null): Assignment[] {
  if (!candidate.active) return [];
  return existing.filter((e) => e.id !== ignoreId && e.active && e.scriptId !== candidate.scriptId && e.scope === candidate.scope && e.userId === candidate.userId && e.domainId === candidate.domainId
    && e.priority === candidate.priority && windowsOverlap(e, candidate));
}

// ---------------------------------------------------------------- libellés lisibles
const DAY_NAMES = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const dateFr = (d: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const hourFr = (t: string) => { const [h, m] = t.split(":"); return m === "00" ? `${Number(h)} h` : `${Number(h)} h ${m}`; };

export function describeDays(days: number[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return "tous les jours";
  const s = [...days].sort((a, b) => a - b);
  if (s.length > 2 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${DAY_NAMES[s[0] - 1]} au ${DAY_NAMES[s[s.length - 1] - 1]}`;
  return s.map((d) => DAY_NAMES[d - 1]).join(", ");
}
export function describeWindow(a: Pick<Assignment, "startsOn" | "endsOn" | "days" | "timeFrom" | "timeTo">): string {
  const parts: string[] = [];
  if (a.startsOn && a.endsOn) parts.push(`du ${dateFr(a.startsOn)} au ${dateFr(a.endsOn)}`);
  else if (a.startsOn) parts.push(`à partir du ${dateFr(a.startsOn)}`);
  else if (a.endsOn) parts.push(`jusqu'au ${dateFr(a.endsOn)}`);
  if (a.days && a.days.length > 0 && a.days.length < 7) parts.push(describeDays(a.days));
  if (a.timeFrom && a.timeTo) parts.push(`de ${hourFr(a.timeFrom)} à ${hourFr(a.timeTo)}`);
  return parts.length ? parts.join(", ") : "en permanence";
}

export type AssignmentStatus = "inactive" | "expired" | "upcoming" | "live" | "later";
/** État d'une programmation à un instant donné : inactive, terminée, à venir, en cours, ou dans sa période mais hors jour / horaire. */
export function assignmentStatus(a: Pick<Assignment, "active" | "startsOn" | "endsOn" | "days" | "timeFrom" | "timeTo">, now: Date): AssignmentStatus {
  if (!a.active) return "inactive";
  const l = localParts(now);
  if (a.endsOn && l.date > a.endsOn) return "expired";
  if (a.startsOn && l.date < a.startsOn) return "upcoming";
  return windowCovers(a, now) ? "live" : "later";
}
export const STATUS_LABELS: Record<AssignmentStatus, string> = { inactive: "Désactivée", expired: "Terminée", upcoming: "À venir", live: "En cours", later: "Hors horaire" };

/** Message de chevauchement ambigu affiché à l'administrateur. */
export function overlapMessage(overlaps: Assignment[], scriptName: (id: string) => string): string {
  const names = [...new Set(overlaps.map((o) => `« ${scriptName(o.scriptId)} »`))].join(", ");
  return `Cette programmation se recoupe avec ${names} à priorité égale : c'est l'ordre des formulaires qui décidera. Donnez une priorité plus haute à celui qui doit passer en premier.`;
}

export const REASON_LABELS: Record<ResolveReason, string> = { lead_domain: "Domaine du lead", member_domain: "Domaine du téléprospecteur", generic: "Formulaire générique", other: "Autre domaine" };
