import { z } from "zod";
import { cleanText, neutralizeFormula, normalizeEmail } from "@/lib/leads/normalize";

export const INBOUND_KINDS = ["generic", "meta", "google"] as const;
export type InboundKind = (typeof INBOUND_KINDS)[number];

export interface InboundLead {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  value: number | null;
  custom: Record<string, unknown>;
}

export const GENERIC_TARGETS = ["firstName", "lastName", "fullName", "email", "phone", "company", "address", "city", "postalCode", "value"] as const;
/** Mappage générique : chemin JSON (a.b.0.c) -> champ du lead (ou custom.<clé>). */
export const mappingConfigSchema = z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/), z.string().regex(/^(firstName|lastName|fullName|email|phone|company|address|city|postalCode|value|custom\.[a-z][a-z0-9_]{1,40})$/)).refine((m) => Object.keys(m).length <= 30, "Trop de règles.");

const DEFAULT_GENERIC: Record<string, string> = {
  email: "email", mail: "email", phone: "phone", telephone: "phone", tel: "phone", mobile: "phone",
  first_name: "firstName", firstName: "firstName", prenom: "firstName", last_name: "lastName", lastName: "lastName", nom: "lastName",
  name: "fullName", full_name: "fullName", fullName: "fullName", company: "company", societe: "company", city: "city", ville: "city",
  zip: "postalCode", postal_code: "postalCode", postalCode: "postalCode", address: "address", adresse: "address", value: "value", budget: "value",
};

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    cur = Array.isArray(cur) ? cur[Number(part)] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const scalar = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? cleanText(String(v), 300) : "");

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.length <= 1 ? ["", parts[0] ?? ""] : [parts[0]!, parts.slice(1).join(" ")];
}

function empty(): InboundLead {
  return { firstName: "", lastName: "", email: null, phone: null, company: null, address: null, city: null, postalCode: null, value: null, custom: {} };
}

function assign(lead: InboundLead, target: string, raw: unknown) {
  const v = scalar(raw);
  if (!v) return;
  if (target.startsWith("custom.")) { lead.custom[target.slice(7)] = typeof raw === "number" ? raw : v; return; }
  switch (target) {
    case "firstName": lead.firstName = v.slice(0, 80); break;
    case "lastName": lead.lastName = v.slice(0, 80); break;
    case "fullName": { const [f, l] = splitName(v); lead.firstName = f.slice(0, 80); lead.lastName = l.slice(0, 80); break; }
    case "email": lead.email = v; break;
    case "phone": lead.phone = v; break;
    case "company": lead.company = v.slice(0, 120); break;
    case "address": lead.address = v.slice(0, 300); break;
    case "city": lead.city = v.slice(0, 100); break;
    case "postalCode": lead.postalCode = v.slice(0, 12); break;
    case "value": { const n = Number(v.replace(",", ".")); if (Number.isFinite(n)) lead.value = n; break; }
  }
}

export function adaptGeneric(body: unknown, mapping: Record<string, string>): InboundLead[] {
  const rules = Object.keys(mapping).length ? mapping : DEFAULT_GENERIC;
  const lead = empty();
  for (const [path, target] of Object.entries(rules)) assign(lead, target, getPath(body, path));
  return [lead];
}

const META_NAMES: Record<string, string> = {
  full_name: "fullName", first_name: "firstName", last_name: "lastName", email: "email", phone_number: "phone", phone: "phone",
  company_name: "company", city: "city", zip_code: "postalCode", post_code: "postalCode", street_address: "address",
};

/** Meta Lead Ads : { entry:[{ changes:[{ field:"leadgen", value:{ field_data:[{name, values:[...]}] } }] }] } (ou field_data direct). */
export function adaptMeta(body: unknown): InboundLead[] {
  const out: InboundLead[] = [];
  const fromFieldData = (fd: unknown) => {
    if (!Array.isArray(fd)) return;
    const lead = empty();
    for (const f of fd.slice(0, 50)) {
      const name = (f as { name?: unknown })?.name;
      const values = (f as { values?: unknown })?.values;
      if (typeof name !== "string") continue;
      const first = Array.isArray(values) ? values[0] : undefined;
      const target = META_NAMES[name.toLowerCase()];
      if (target) assign(lead, target, first);
    }
    out.push(lead);
  };
  const b = body as { entry?: unknown; field_data?: unknown };
  if (Array.isArray(b?.entry)) {
    for (const e of b.entry.slice(0, 20)) {
      const changes = (e as { changes?: unknown })?.changes;
      if (!Array.isArray(changes)) continue;
      for (const c of changes.slice(0, 20)) {
        if ((c as { field?: unknown })?.field === "leadgen") fromFieldData(((c as { value?: { field_data?: unknown } }).value ?? {}).field_data);
      }
    }
  } else fromFieldData(b?.field_data);
  return out;
}

const GOOGLE_COLUMNS: Record<string, string> = {
  FULL_NAME: "fullName", FIRST_NAME: "firstName", LAST_NAME: "lastName", EMAIL: "email", PHONE_NUMBER: "phone",
  COMPANY_NAME: "company", CITY: "city", POSTAL_CODE: "postalCode", STREET_ADDRESS: "address",
};

/** Google Ads (extensions de formulaire) : { user_column_data:[{ column_id, string_value }], google_key }. */
export function adaptGoogle(body: unknown): InboundLead[] {
  const cols = (body as { user_column_data?: unknown })?.user_column_data;
  if (!Array.isArray(cols)) return [];
  const lead = empty();
  for (const c of cols.slice(0, 50)) {
    const id = (c as { column_id?: unknown })?.column_id;
    const target = typeof id === "string" ? GOOGLE_COLUMNS[id.toUpperCase()] : undefined;
    if (target) assign(lead, target, (c as { string_value?: unknown }).string_value);
  }
  return [lead];
}

export const googleKeyOf = (body: unknown): string | null => {
  const k = (body as { google_key?: unknown })?.google_key;
  return typeof k === "string" ? k : null;
};

export function adapt(kind: InboundKind, body: unknown, mapping: Record<string, string>): InboundLead[] {
  return kind === "meta" ? adaptMeta(body) : kind === "google" ? adaptGoogle(body) : adaptGeneric(body, mapping);
}

const emailZ = z.email().max(200);
const phoneRe = /^[0-9+().\s-]{6,40}$/;

/** Validation finale d'un lead entrant. Retourne le lead propre ou le motif de rejet. */
export function finalizeInbound(l: InboundLead): { ok: true; lead: InboundLead } | { ok: false; reason: string } {
  const email = l.email ? normalizeEmail(l.email) : null;
  if (email && (!emailZ.safeParse(email).success || email.includes(",") || /^[=+\-@]/.test(email))) return { ok: false, reason: "invalid_email" };
  if (l.phone && !phoneRe.test(l.phone)) return { ok: false, reason: "invalid_phone" };
  if (l.value !== null && (l.value < 0 || l.value > 1e9)) return { ok: false, reason: "invalid_value" };
  // Champs personnalisés texte : formules neutralisées (exports tableur) ; les caractères bidi sont retirés par cleanText.
  const custom = Object.fromEntries(Object.entries(l.custom).map(([k, v]) => [k, typeof v === "string" ? neutralizeFormula(v) : v]));
  const out: InboundLead = {
    ...l,
    custom,
    email,
    firstName: neutralizeFormula(l.firstName),
    lastName: neutralizeFormula(l.lastName),
    company: l.company ? neutralizeFormula(l.company) : null,
    address: l.address ? neutralizeFormula(l.address) : null,
    city: l.city ? neutralizeFormula(l.city) : null,
  };
  if (!out.firstName && !out.lastName && !out.company) {
    // Aucun nom fourni : identifiant de contact en dernier recours.
    if (email) out.lastName = email.slice(0, 80);
    else if (out.phone) out.lastName = out.phone.slice(0, 80);
    else return { ok: false, reason: "no_identity" };
  }
  if (!email && !out.phone) return { ok: false, reason: "no_contact" };
  return { ok: true, lead: out };
}

const TARGET_LABEL = GENERIC_TARGETS.join(", ");

/** Message lisible (FR) pour un mappage invalide, ou null s'il est valide. */
export function explainMapping(mapping: Record<string, string>): string | null {
  const entries = Object.entries(mapping);
  if (entries.length > 30) return "Trop de règles (30 maximum).";
  for (const [path, target] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(path)) return `Règle « ${path} -> ${target} » : le chemin JSON ne doit contenir que lettres, chiffres, « . », « _ » et « - » (80 caractères maximum).`;
    if (!/^(firstName|lastName|fullName|email|phone|company|address|city|postalCode|value|custom\.[a-z][a-z0-9_]{1,40})$/.test(target)) {
      return `Règle « ${path} -> ${target} » : champ « ${target} » inconnu. Champs possibles : ${TARGET_LABEL}, custom.<clé> (clé en minuscules).`;
    }
  }
  return null;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  parts.forEach((p, i) => {
    if (p === "__proto__" || p === "constructor" || p === "prototype") return;
    if (i === parts.length - 1) cur[p] = value;
    else cur = (cur[p] && typeof cur[p] === "object" ? cur[p] : (cur[p] = {})) as Record<string, unknown>;
  });
}

/** Charge de test conforme au mappage de l'endpoint (générique) ; Meta / Google : formats natifs. */
export function buildTestPayload(kind: InboundKind, mapping: Record<string, string>, n: number): unknown {
  if (kind === "meta") return { entry: [{ changes: [{ field: "leadgen", value: { field_data: [{ name: "full_name", values: [`Test Meta ${n}`] }, { name: "email", values: [`meta+${n}@leadforge.example`] }, { name: "phone_number", values: ["+33600000000"] }] } }] }] };
  if (kind === "google") return { user_column_data: [{ column_id: "FULL_NAME", string_value: `Test Google ${n}` }, { column_id: "EMAIL", string_value: `google+${n}@leadforge.example` }] };
  const samples: Record<string, unknown> = {
    firstName: "Test", lastName: `LeadForge ${n}`, fullName: `Test LeadForge ${n}`, email: `test+${n}@leadforge.example`,
    phone: `06 00 00 ${String(n % 100).padStart(2, "0")} 00`, company: "Société de test", address: "1 rue du Test", city: "Paris", postalCode: "75001", value: 1000,
  };
  const rules = Object.keys(mapping).length ? mapping : { first_name: "firstName", last_name: "lastName", email: "email", phone: "phone" };
  const body: Record<string, unknown> = {};
  for (const [path, target] of Object.entries(rules)) setPath(body, path, target.startsWith("custom.") ? "test" : samples[target]);
  return body;
}
