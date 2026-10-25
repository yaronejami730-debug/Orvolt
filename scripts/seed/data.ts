/**
 * Générateur de données de démonstration (pur, déterministe, sans réseau ni base).
 * Toutes les personnes, adresses de rue, e-mails (@example.test) et numéros (06 39 98 xx xx, plage fictive) sont inventés.
 */
import { haversineKm } from "../../src/lib/geo/haversine";

export const DEMO_PASSWORD = "Demo1234!";
export const DEMO_DOMAIN = "demo.test";
export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export type OrgKey = "energies" | "artisan";
export type RoleName = "Super administrateur" | "Administrateur" | "Prospecteur" | "Confirmateur" | "Commercial";

export interface DemoUser {
  key: string;
  email: string;
  fullName: string;
  /** Rôle par organisation. */
  orgs: Partial<Record<OrgKey, RoleName>>;
}

/** 7 comptes au total ; Pauline Roche (commercial) est membre des deux organisations, Karim Benali (commercial2) de la première. */
export const DEMO_USERS: DemoUser[] = [
  { key: "admin_energies", email: `admin.energies@${DEMO_DOMAIN}`, fullName: "Hélène Marchand", orgs: { energies: "Super administrateur" } },
  { key: "administrateur", email: `administrateur@${DEMO_DOMAIN}`, fullName: "Camille Girard", orgs: { energies: "Administrateur" } },
  { key: "prospecteur", email: `prospecteur@${DEMO_DOMAIN}`, fullName: "Julien Moreau", orgs: { energies: "Prospecteur" } },
  { key: "confirmateur", email: `confirmateur@${DEMO_DOMAIN}`, fullName: "Sophie Bernard", orgs: { energies: "Confirmateur" } },
  { key: "commercial", email: `commercial@${DEMO_DOMAIN}`, fullName: "Pauline Roche", orgs: { energies: "Commercial", artisan: "Commercial" } },
  { key: "commercial2", email: `commercial2@${DEMO_DOMAIN}`, fullName: "Karim Benali", orgs: { energies: "Commercial" } },
  { key: "admin_artisan", email: `admin.artisan@${DEMO_DOMAIN}`, fullName: "Marc Dupont", orgs: { artisan: "Super administrateur" } },
];

/* ---------- PRNG ---------- */
export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  chance(p: number): boolean;
}
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)]!,
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        r -= w;
        if (r < 0) return v;
      }
      return items[items.length - 1]![0];
    },
    chance: (p) => next() < p,
  };
  return rng;
}

/* ---------- Référentiels ---------- */
const FIRST = ["Camille", "Lucas", "Emma", "Hugo", "Léa", "Louis", "Chloé", "Nathan", "Manon", "Arthur", "Inès", "Gabriel", "Sarah", "Raphaël", "Julie", "Paul", "Laura", "Antoine", "Clara", "Maxime", "Marion", "Alexandre", "Pauline", "Nicolas", "Océane", "Romain", "Élodie", "Mathieu", "Céline", "Vincent", "Anaïs", "Julien", "Sandrine", "Benoît", "Aurélie", "Olivier", "Karine", "Damien", "Nadia", "Yann", "Fatima", "Sébastien", "Valérie", "Cédric", "Christelle", "Pierre", "Isabelle", "Michel", "Nathalie", "Philippe"];
const LAST = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel", "Girard", "André", "Mercier", "Dupuis", "Lambert", "Bonnet", "François", "Martinez", "Legrand", "Garnier", "Faure", "Rousseau", "Blanc", "Guerin", "Muller", "Henry", "Roussel", "Nicolas", "Perrin", "Morin", "Mathieu", "Clément", "Gauthier", "Dumont", "Lopez", "Fontaine", "Chevalier", "Robin", "Masson"];
const STREETS = ["rue de la République", "avenue Jean Jaurès", "rue Victor Hugo", "chemin des Vignes", "rue des Lilas", "boulevard Pasteur", "rue Jules Ferry", "impasse des Tilleuls", "allée des Platanes", "rue du Président Wilson", "avenue de la Gare", "rue Pasteur", "rue des Écoles", "route de l'Église", "rue du Moulin", "rue des Acacias", "avenue des Frères Lumière", "rue Gambetta", "rue de la Paix", "chemin du Stade", "rue des Peupliers", "rue du Château"];

interface City { name: string; postal: string; lat: number; lng: number; weight: number }

const CITIES_ENERGIES: City[] = [
  { name: "Lyon", postal: "69003", lat: 45.764, lng: 4.8357, weight: 22 },
  { name: "Villeurbanne", postal: "69100", lat: 45.7719, lng: 4.8902, weight: 14 },
  { name: "Vénissieux", postal: "69200", lat: 45.697, lng: 4.8867, weight: 8 },
  { name: "Caluire-et-Cuire", postal: "69300", lat: 45.7956, lng: 4.8466, weight: 7 },
  { name: "Bron", postal: "69500", lat: 45.7385, lng: 4.9136, weight: 6 },
  { name: "Saint-Priest", postal: "69800", lat: 45.6962, lng: 4.9459, weight: 6 },
  { name: "Oullins", postal: "69600", lat: 45.7144, lng: 4.8086, weight: 6 },
  { name: "Tassin-la-Demi-Lune", postal: "69160", lat: 45.7616, lng: 4.7508, weight: 5 },
  { name: "Écully", postal: "69130", lat: 45.7766, lng: 4.7788, weight: 5 },
  { name: "Meyzieu", postal: "69330", lat: 45.7677, lng: 5.0043, weight: 5 },
  { name: "Villefranche-sur-Saône", postal: "69400", lat: 45.9895, lng: 4.7186, weight: 4 },
  { name: "Bourgoin-Jallieu", postal: "38300", lat: 45.5862, lng: 5.2736, weight: 3 },
  { name: "Saint-Étienne", postal: "42000", lat: 45.4397, lng: 4.3872, weight: 4 },
  { name: "Grenoble", postal: "38000", lat: 45.1885, lng: 5.7245, weight: 2 },
];
const CITIES_ARTISAN: City[] = [
  { name: "Nantes", postal: "44000", lat: 47.2184, lng: -1.5536, weight: 25 },
  { name: "Saint-Herblain", postal: "44800", lat: 47.2122, lng: -1.6486, weight: 12 },
  { name: "Rezé", postal: "44400", lat: 47.1815, lng: -1.5497, weight: 10 },
  { name: "Orvault", postal: "44700", lat: 47.2753, lng: -1.6224, weight: 7 },
  { name: "Vertou", postal: "44120", lat: 47.1693, lng: -1.4697, weight: 6 },
  { name: "Carquefou", postal: "44470", lat: 47.2979, lng: -1.4912, weight: 6 },
  { name: "Saint-Sébastien-sur-Loire", postal: "44230", lat: 47.2056, lng: -1.5036, weight: 7 },
  { name: "Couëron", postal: "44220", lat: 47.2147, lng: -1.7279, weight: 5 },
  { name: "Sainte-Luce-sur-Loire", postal: "44980", lat: 47.2478, lng: -1.4844, weight: 4 },
  { name: "Clisson", postal: "44190", lat: 47.0866, lng: -1.2778, weight: 3 },
  { name: "Saint-Nazaire", postal: "44600", lat: 47.2735, lng: -2.2137, weight: 4 },
  { name: "Angers", postal: "49000", lat: 47.4784, lng: -0.5632, weight: 2 },
];

const NOTES = {
  early: ["Premier échange : projet confirmé, souhaite être rappelé en fin de journée.", "Demande reçue via le formulaire, coordonnées vérifiées.", "Client joignable de préférence le matin avant 10 h.", "Intéressé, souhaite comparer avec un autre devis avant de s'engager."],
  mid: ["Projet qualifié : propriétaire, budget cohérent, disponible en semaine après 17 h.", "Accès au logement confirmé, un voisin garde les clés en journée.", "Souhaite un rendez-vous rapide, travaux envisagés avant la fin de saison.", "Dossier de financement en cours de préparation côté client."],
  late: ["Devis envoyé par e-mail, relance prévue sous 5 jours.", "Visite réalisée, client satisfait de la présentation, attend l'accord de son conjoint.", "Devis ajusté suite à la visite, nouvelle version transmise.", "Demande d'un échelonnement du paiement, à valider en interne."],
  won: ["Signature reçue, dossier transmis à la planification.", "Devis accepté, acompte annoncé sous 48 h."],
  lost: ["A choisi un autre prestataire (prix).", "Projet reporté à l'an prochain, à recontacter au printemps.", "Injoignable après plusieurs relances, dossier clos.", "Budget insuffisant, projet abandonné."],
};
const CALL_NOTES = ["Message laissé, rappel à prévoir.", "Échange cordial, besoins précisés.", "Demande de documents complémentaires.", "RDV convenu par téléphone.", "Souhaite être rappelé demain.", "Question sur les délais de réalisation."];
const OVERRIDE_REASONS = ["Client prioritaire, déplacement validé par la direction.", "Tournée groupée avec un autre rendez-vous dans le secteur.", "Projet à forte valeur, dérogation accordée."];
const ENERGIES_TASKS = ["Relancer pour le devis", "Envoyer le dossier d'aides", "Rappeler après la visite technique"];
const ARTISAN_TASKS = ["Relancer pour le devis", "Envoyer les photos du chantier", "Confirmer la date de démarrage"];

/* ---------- Types de sortie ---------- */
export interface GenNote { id: string; authorKey: string; body: string; at: Date }
export interface GenCall { id: string; callerKey: string; outcome: "answered" | "no_answer" | "voicemail" | "busy" | "wrong_number" | "callback"; durationSeconds: number; notes: string | null; at: Date }
export interface GenTransition { fromKey: string; toKey: string; at: Date; actorKey: string }
export interface GenAppt {
  id: string; assignedKey: string; startsAt: Date; endsAt: Date; status: "planned" | "confirmed" | "done" | "cancelled" | "no_show";
  address: string; lat: number; lng: number; distanceKm: number | null; distanceStatus: "ok" | "over_radius" | "no_zone";
  override: boolean; overrideReason: string | null; overrideByKey: string | null; notes: string | null; createdAt: Date; createdByKey: string;
}
export interface GenLead {
  id: string; idx: number; first_name: string; last_name: string; company: string | null; email: string; phone: string;
  address: string; city: string; postal_code: string; lat: number; lng: number; value: number | null;
  custom: Record<string, string | number>; statusKey: string; sourceName: string; assignedKey: string | null; createdByKey: string | null;
  createdAt: Date; updatedAt: Date; transitions: GenTransition[]; notes: GenNote[]; calls: GenCall[]; appointments: GenAppt[];
}
export interface GenTask { id: string; leadId: string; assignedKey: string; title: string; dueAt: Date; done: boolean; doneAt: Date | null; createdAt: Date; dedupe: string }
export interface GenNotification { userKey: string; leadId: string; leadName: string; status: string; message: string; readAt: Date | null; createdAt: Date; dedupe: string }
export interface GenZone { userKey: string; baseAddress: string; lat: number; lng: number; radiusKm: number; workStart?: string; workEnd?: string }
export interface GenOrg { key: OrgKey; leads: GenLead[]; tasks: GenTask[]; notifications: GenNotification[]; zones: GenZone[] }

export interface StatusLite { key: string; name: string; kind: "normal" | "won" | "lost"; initial?: boolean }
export interface TransitionLite { from: string; to: string }

export interface OrgSpec {
  key: OrgKey;
  name: string;
  templateId: "energie" | "btp";
  leadCount: number;
  cities: City[];
  sources: (readonly [string, number])[];
  /** Statut à partir duquel un rendez-vous existe. */
  apptFromKey: string;
  /** Statuts qui déclenchent une tâche automatique du template. */
  autoTask: { statusKey: string; title: string };
  followTasks: string[];
  creators: (readonly [string | null, number])[];
  assignees: { early: (string | null)[]; mid: (string | null)[]; late: (string | null)[] };
  sellers: string[];
  zones: GenZone[];
  /** Utilisateur qui reçoit les dérogations (Super administrateur). */
  adminKey: string;
  notifyKeys: string[];
}

export const ORG_SPECS: OrgSpec[] = [
  {
    key: "energies", name: "Énergie Verte Démo", templateId: "energie", leadCount: 120, cities: CITIES_ENERGIES,
    sources: [["Meta Ads", 30], ["Google Ads", 22], ["Site web", 18], ["Parrainage", 12], ["Salon", 6], ["Autre", 4], ["Import CSV", 4], ["Webhook", 4]],
    apptFromKey: "rdv_pris", autoTask: { statusKey: "rdv_pris", title: "Préparer la visite technique" }, followTasks: ENERGIES_TASKS,
    creators: [["prospecteur", 60], ["confirmateur", 20], ["admin_energies", 20]],
    assignees: { early: ["prospecteur", "prospecteur", null], mid: ["confirmateur", "commercial"], late: ["commercial"] },
    sellers: ["commercial"], adminKey: "admin_energies", notifyKeys: ["admin_energies", "confirmateur", "commercial"],
    zones: [
      { userKey: "commercial", baseAddress: "Place Bellecour, 69002 Lyon", lat: 45.7578, lng: 4.832, radiusKm: 40, workStart: "09:00", workEnd: "19:00" },
      { userKey: "commercial2", baseAddress: "Place Léon Sublet, 69200 Vénissieux", lat: 45.6977, lng: 4.8869, radiusKm: 25, workStart: "10:00", workEnd: "20:00" },
    ],
  },
  {
    key: "artisan", name: "Artisans Dupont Démo", templateId: "btp", leadCount: 80, cities: CITIES_ARTISAN,
    sources: [["Site web", 25], ["Parrainage", 25], ["Google Ads", 20], ["Meta Ads", 12], ["Salon", 6], ["Autre", 6], ["Import CSV", 3], ["Webhook", 3]],
    apptFromKey: "visite", autoTask: { statusKey: "visite", title: "Prendre les mesures sur place" }, followTasks: ARTISAN_TASKS,
    creators: [["admin_artisan", 70], ["commercial", 30]],
    assignees: { early: ["admin_artisan", null], mid: ["admin_artisan", "commercial"], late: ["commercial", "admin_artisan"] },
    sellers: ["commercial", "admin_artisan"], adminKey: "admin_artisan", notifyKeys: ["admin_artisan", "commercial"],
    zones: [
      { userKey: "admin_artisan", baseAddress: "Place Royale, 44000 Nantes", lat: 47.2154, lng: -1.5586, radiusKm: 40 },
      { userKey: "commercial", baseAddress: "Place Pierre Sémard, 44400 Rezé", lat: 47.1815, lng: -1.5497, radiusKm: 30 },
    ],
  },
];

/* ---------- Utilitaires ---------- */
const pad2 = (n: number) => String(n).padStart(2, "0");
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const round = (n: number, step: number) => Math.round(n / step) * step;

/** Numéro fictif (plage 06 39 98 xx xx) unique par rang. */
export function demoPhone(n: number): string {
  const k = n % 10000;
  return `06 39 98 ${pad2(Math.floor(k / 100))} ${pad2(k % 100)}`;
}
const PAR_TZ = "Europe/Paris";
export const parisHour = (d: Date) => parseInt(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: PAR_TZ }).format(d), 10);

function uuidFactory(seed: number) {
  const r = makeRng(seed);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r.next() * 16).toString(16)).join("");
  return () => `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(r.next() * 4)]}${hex(3)}-${hex(12)}`;
}

/** Prochain créneau ouvré (lun-ven, 9 h-17 h Paris) libre pour ce commercial, au plus tôt à `from`. */
function slotAfter(from: Date, taken: Set<string>, userKey: string): Date {
  const d = new Date(Math.ceil(from.getTime() / HOUR) * HOUR);
  for (let i = 0; i < 400; i++) {
    const dow = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: PAR_TZ }).format(d);
    const h = parisHour(d);
    if (dow !== "Sat" && dow !== "Sun" && h >= 9 && h <= 17 && !taken.has(`${userKey}:${d.toISOString()}`)) {
      taken.add(`${userKey}:${d.toISOString()}`);
      return d;
    }
    d.setTime(d.getTime() + HOUR);
  }
  return d;
}

export interface GenerateInput {
  spec: OrgSpec;
  statuses: StatusLite[];
  transitions: TransitionLite[];
  now?: Date;
  seed?: number;
}

export function generateOrg({ spec, statuses, transitions, now = new Date(), seed = 20260101 }: GenerateInput): GenOrg {
  const rng = makeRng(seed + (spec.key === "energies" ? 1 : 2));
  const uuid = uuidFactory(seed * 7 + (spec.key === "energies" ? 11 : 13));
  const taken = new Set<string>();
  const nowMs = now.getTime();

  const initial = statuses.find((s) => s.initial)!;
  const won = statuses.find((s) => s.kind === "won")!;
  const lost = statuses.find((s) => s.kind === "lost")!;
  const normals = statuses.filter((s) => s.kind === "normal");
  const lostFrom = normals.filter((s) => s !== initial && transitions.some((t) => t.from === s.key && t.to === lost.key));
  const apptIdx = normals.findIndex((s) => s.key === spec.apptFromKey);
  const nameOf = (key: string) => statuses.find((s) => s.key === key)!.name;
  const isEnergies = spec.key === "energies";

  const leads: GenLead[] = [];
  const tasks: GenTask[] = [];
  const notifications: GenNotification[] = [];
  const zoneOf = (k: string) => spec.zones.find((z) => z.userKey === k);

  for (let i = 0; i < spec.leadCount; i++) {
    const age = 0.2 + 89 * Math.pow(rng.next(), 0.85);
    const createdMs = nowMs - age * DAY;
    const closedProb = Math.min(0.6, Math.max(0.03, (age - 8) / 80));
    let path: StatusLite[];
    if (rng.chance(closedProb)) {
      if (rng.chance(0.4)) path = [...normals, won];
      else {
        const from = rng.pick(lostFrom);
        path = [...normals.slice(0, normals.indexOf(from) + 1), lost];
      }
    } else {
      const maxIdx = Math.min(normals.length - 1, Math.floor(age / 6) + 1);
      const idx = Math.floor(rng.next() * (maxIdx + 1));
      path = normals.slice(0, idx + 1);
    }
    const finalStatus = path[path.length - 1]!;
    const stageIdx = Math.max(0, normals.indexOf(path.length > 1 && finalStatus.kind !== "normal" ? path[path.length - 2]! : finalStatus));
    const tier: "early" | "mid" | "late" = stageIdx <= 0 ? "early" : stageIdx < Math.min(2, normals.length - 1) ? "mid" : "late";
    const assignedKey = rng.pick(spec.assignees[tier]) ?? (tier === "late" ? spec.sellers[0]! : null);
    const actorFor = (t: "early" | "mid" | "late") => assignedKey ?? (t === "early" ? spec.creators[0]![0]! : spec.sellers[0]!);

    // Identité, adresse, coordonnées
    const city = rng.weighted(spec.cities.map((c) => [c, c.weight] as const));
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const company = !isEnergies && rng.chance(0.06) ? `SCI ${rng.pick(["Les Tilleuls", "Le Clos Fleuri", "Les Mouettes", "Beauséjour"])}` : null;
    const addrNo = rng.int(1, 120);
    const street = `${addrNo} ${rng.pick(STREETS)}`;
    const sourceName = rng.weighted(spec.sources);
    const creatorKey = sourceName === "Webhook" ? null : rng.weighted(spec.creators.map((c) => [c[0], c[1]] as const));

    // Chronologie
    const span = (nowMs - createdMs) * (finalStatus.kind !== "normal" ? 0.45 + 0.5 * rng.next() : 0.8 + 0.19 * rng.next());
    const steps = path.length - 1;
    const fractions = Array.from({ length: steps }, () => rng.next()).sort((a, b) => a - b);
    const transitionsOut: GenTransition[] = [];
    const entered = new Map<string, Date>([[path[0]!.key, new Date(createdMs)]]);
    for (let j = 0; j < steps; j++) {
      const at = new Date(createdMs + span * (0.05 + 0.95 * fractions[j]!) + 5 * 60_000 * (j + 1));
      const stg: "early" | "mid" | "late" = j === 0 ? "early" : j < 2 ? "mid" : "late";
      transitionsOut.push({ fromKey: path[j]!.key, toKey: path[j + 1]!.key, at, actorKey: j === 0 ? actorFor("early") : actorFor(stg) });
      entered.set(path[j + 1]!.key, at);
    }
    const updatedAt = transitionsOut.length ? transitionsOut[transitionsOut.length - 1]!.at : new Date(createdMs);

    // Valeur & champs personnalisés
    const reachedQual = stageIdx >= 2 || finalStatus.kind === "won";
    let value: number | null = null;
    const custom: Record<string, string | number> = {};
    const fullAddress = `${street}, ${city.postal} ${city.name}`;
    if (isEnergies) {
      const heating = rng.pick(["Électrique", "Gaz", "Fioul", "Bois", "Pompe à chaleur"]);
      custom.type_chauffage = heating;
      custom.surface_m2 = rng.int(55, 230);
      if (rng.chance(0.8)) custom.facture_energie = round(rng.int(60, 320), 5);
      custom.statut_occupant = rng.chance(0.86) ? "Propriétaire" : "Locataire";
      if (rng.chance(0.5)) custom.dpe = rng.weighted([["C", 20], ["D", 30], ["E", 25], ["F", 15], ["G", 10]] as const);
      custom.adresse_chantier = fullAddress;
      if (finalStatus.kind === "won" || (reachedQual && rng.chance(0.75))) value = round(rng.int(3500, 24000), 50);
    } else {
      const work = rng.pick(["Rénovation", "Toiture", "Plomberie", "Électricité", "Peinture", "Extension"]);
      custom.type_travaux = work;
      const ranges: Record<string, [number, number]> = { Rénovation: [8000, 42000], Toiture: [6000, 26000], Plomberie: [600, 5500], Électricité: [900, 8000], Peinture: [1200, 9000], Extension: [25000, 90000] };
      const [lo, hi] = ranges[work]!;
      custom.budget = round(rng.int(lo, hi), 100);
      custom.urgence = rng.weighted([["Faible", 35], ["Moyenne", 45], ["Élevée", 20]] as const);
      custom.adresse_chantier = fullAddress;
      if (finalStatus.kind === "won" || (reachedQual && rng.chance(0.75))) value = round((custom.budget as number) * (0.85 + 0.2 * rng.next()), 50);
    }

    const leadId = uuid();
    const lead: GenLead = {
      id: leadId, idx: i, first_name: first, last_name: last, company,
      email: `${slug(first)}.${slug(last)}${i + 1}@example.test`,
      phone: demoPhone(i * 37 + (isEnergies ? 11 : 5003)),
      address: street, city: city.name, postal_code: city.postal,
      lat: Math.round((city.lat + (rng.next() - 0.5) * 0.024) * 1e6) / 1e6,
      lng: Math.round((city.lng + (rng.next() - 0.5) * 0.032) * 1e6) / 1e6,
      value, custom, statusKey: finalStatus.key, sourceName, assignedKey, createdByKey: creatorKey,
      createdAt: new Date(createdMs), updatedAt, transitions: transitionsOut, notes: [], calls: [], appointments: [],
    };

    // Notes & appels (dates cohérentes avec la chronologie)
    const between = (a: Date, b: Date) => new Date(a.getTime() + (b.getTime() - a.getTime()) * (0.1 + 0.8 * rng.next()));
    const voice = assignedKey ?? actorFor("early");
    if (path.length > 1 || rng.chance(0.4)) {
      lead.notes.push({ id: uuid(), authorKey: voice, body: rng.pick(NOTES[tier === "early" ? "early" : tier === "mid" ? "mid" : "late"]), at: between(lead.createdAt, updatedAt.getTime() > createdMs ? updatedAt : new Date(createdMs + HOUR)) });
    }
    if (finalStatus.kind !== "normal") {
      lead.notes.push({ id: uuid(), authorKey: voice, body: rng.pick(finalStatus.kind === "won" ? NOTES.won : NOTES.lost), at: new Date(updatedAt.getTime() + 20 * 60_000 > nowMs ? nowMs - 60_000 : updatedAt.getTime() + 20 * 60_000) });
    }
    if (tier !== "early" && rng.chance(0.4)) lead.notes.push({ id: uuid(), authorKey: rng.pick([voice, spec.adminKey]), body: rng.pick(NOTES.mid), at: between(lead.createdAt, updatedAt) });
    const nCalls = tier === "early" ? rng.int(0, 2) : rng.int(1, 3);
    for (let c = 0; c < nCalls; c++) {
      const outcome = rng.weighted([["answered", 50], ["no_answer", 20], ["voicemail", 12], ["callback", 10], ["busy", 5], ["wrong_number", 3]] as const);
      lead.calls.push({
        id: uuid(), callerKey: voice, outcome,
        durationSeconds: outcome === "answered" || outcome === "callback" ? rng.int(75, 900) : outcome === "voicemail" ? rng.int(10, 40) : 0,
        notes: rng.chance(0.7) ? rng.pick(CALL_NOTES) : null,
        at: between(lead.createdAt, updatedAt.getTime() > createdMs + 2 * HOUR ? updatedAt : new Date(createdMs + 2 * HOUR)),
      });
    }

    // Rendez-vous
    const apptStep = path.findIndex((s) => s.key === spec.apptFromKey);
    if (apptStep >= 0 && apptIdx >= 0) {
      const enteredAt = entered.get(spec.apptFromKey)!;
      const nextAt = transitionsOut[apptStep]?.at; // transition qui QUITTE le statut rdv
      const sellerKey = assignedKey && zoneOf(assignedKey) ? assignedKey : spec.sellers[0]!;
      const zone = zoneOf(sellerKey)!;
      const isCurrent = finalStatus.key === spec.apptFromKey;
      let startsAt: Date;
      let status: GenAppt["status"];
      if (isCurrent && rng.chance(0.7)) {
        startsAt = slotAfter(new Date(nowMs + rng.int(1, 14) * DAY + rng.int(0, 8) * HOUR), taken, sellerKey);
        status = rng.chance(0.45) ? "confirmed" : "planned";
      } else {
        const limit = nextAt ?? new Date(nowMs - 2 * HOUR);
        const lo = enteredAt.getTime() + 2 * HOUR;
        const target = new Date(lo + Math.max(HOUR, (limit.getTime() - lo)) * (0.15 + 0.5 * rng.next()));
        startsAt = slotAfter(target, taken, sellerKey);
        if (startsAt.getTime() > nowMs - 2 * HOUR) startsAt = slotAfter(new Date(nowMs - 3 * DAY - rng.int(0, 5) * DAY), taken, sellerKey);
        const roll = rng.next();
        status = roll < 0.07 ? "cancelled" : roll < 0.11 ? "no_show" : "done";
      }
      const km = haversineKm({ lat: lead.lat, lng: lead.lng }, { lat: zone.lat, lng: zone.lng });
      const over = km > zone.radiusKm;
      lead.appointments.push({
        id: uuid(), assignedKey: sellerKey, startsAt, endsAt: new Date(startsAt.getTime() + HOUR), status,
        address: `${lead.address}, ${lead.postal_code} ${lead.city}`, lat: lead.lat, lng: lead.lng,
        distanceKm: Math.round(km * 10) / 10, distanceStatus: over ? "over_radius" : "ok",
        override: over, overrideReason: over ? rng.pick(OVERRIDE_REASONS) : null, overrideByKey: over ? spec.adminKey : null,
        notes: rng.chance(0.4) ? (isEnergies ? "Prévoir le dernier avis de taxe foncière et la facture d'énergie." : "Prévoir échelle et mètre laser, accès par l'allée latérale.") : null,
        createdAt: new Date(Math.min(enteredAt.getTime() + 30 * 60_000, startsAt.getTime() - HOUR)), createdByKey: actorFor("mid"),
      });
      // Tâche automatique du template pour les dossiers au statut RDV
      if (isCurrent) {
        const due = new Date(enteredAt.getTime() + (isEnergies ? 1 : 2) * DAY);
        const done = due.getTime() < nowMs && rng.chance(0.65);
        tasks.push({ id: uuid(), leadId, assignedKey: sellerKey, title: spec.autoTask.title, dueAt: due, done, doneAt: done ? new Date(due.getTime() - 3 * HOUR) : null, createdAt: enteredAt, dedupe: `demo:${spec.key}:${i}:auto` });
      }
    }
    // Relances sur les dossiers au devis
    if (path.length >= normals.length && finalStatus.kind === "normal" && assignedKey) {
      const due = new Date(nowMs + rng.int(-4, 6) * DAY);
      tasks.push({ id: uuid(), leadId, assignedKey, title: rng.pick(spec.followTasks), dueAt: due, done: false, doneAt: null, createdAt: updatedAt, dedupe: `demo:${spec.key}:${i}:follow` });
    }
    leads.push(lead);
  }

  // Notifications : événements récents lisibles par chaque rôle
  const recent = [...leads].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 14);
  recent.forEach((l, n) => {
    const userKey = spec.notifyKeys[n % spec.notifyKeys.length]!;
    const sName = nameOf(l.statusKey);
    const message = l.statusKey === won.key ? "Un dossier vient d'être signé." : l.statusKey === lost.key ? `Dossier clos : ${sName}.` : l.statusKey === initial.key ? "Nouveau lead à qualifier." : `Le lead est passé au statut « ${sName} ».`;
    notifications.push({ userKey, leadId: l.id, leadName: `${l.first_name} ${l.last_name}`, status: sName, message, readAt: n > 6 ? new Date(l.updatedAt.getTime() + 3 * HOUR) : null, createdAt: l.updatedAt, dedupe: `demo:${spec.key}:notif:${n}` });
  });

  return { key: spec.key, leads, tasks, notifications, zones: spec.zones };
}
