import { describe, expect, it } from "vitest";
import { adaptGeneric, adaptGoogle, adaptMeta, finalizeInbound, getPath, googleKeyOf, mappingConfigSchema } from "@/lib/inbound/adapters";
import { generateSecret, generateToken, ipFromHeaders, ipHash, safeEqualHex, sha256Hex, verifyBodySignature, verifySecret } from "@/lib/inbound/auth";
import { signPayload } from "@/lib/automation/signature";

describe("secrets et signatures", () => {
  it("jeton et secret : entropie, préfixe, seul le hachage est dérivable", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(t);
    const s = generateSecret();
    expect(s.secret.startsWith("lfs_")).toBe(true);
    expect(s.hash).toBe(sha256Hex(s.secret));
    expect(s.prefix).toBe(s.secret.slice(0, 8));
    expect(s.hash).not.toContain(s.secret);
  });
  it("verifySecret : exact, refuse vide/trop long/autre", () => {
    const { secret, hash } = generateSecret();
    expect(verifySecret(secret, hash)).toBe(true);
    expect(verifySecret(secret + "x", hash)).toBe(false);
    expect(verifySecret("", hash)).toBe(false);
    expect(verifySecret(null, hash)).toBe(false);
    expect(verifySecret("a".repeat(500), hash)).toBe(false);
    expect(verifySecret(hash, hash)).toBe(false); // le hachage n'est pas le secret
  });
  it("comparaison hex en temps constant : longueurs/formats invalides refusés sans exception", () => {
    expect(safeEqualHex("ab", "abcd")).toBe(false);
    expect(safeEqualHex("zz", "zz")).toBe(false);
    expect(safeEqualHex("00ff", "00FF")).toBe(true);
  });
  it("signature HMAC du corps (horodatage, falsification, rejeu)", () => {
    const { hash } = generateSecret();
    const body = '{"email":"a@b.fr"}';
    const ts = 1_800_000_000;
    const hdr = `t=${ts},v1=${signPayload(hash, ts, body)}`;
    expect(verifyBodySignature(hdr, hash, body, ts + 10)).toBe(true);
    expect(verifyBodySignature(hdr, hash, body + " ", ts + 10)).toBe(false);
    expect(verifyBodySignature(hdr, hash, body, ts + 1000)).toBe(false); // périmé
    expect(verifyBodySignature(null, hash, body)).toBe(false);
    expect(verifyBodySignature("t=1,v1=zz", hash, body)).toBe(false);
  });
  it("IP : en-tête de proxy ignoré sans TRUSTED_PROXY ; hachage salé", () => {
    const get = (n: string) => (n === "x-forwarded-for" ? "6.6.6.6, 203.0.113.9" : null);
    expect(ipFromHeaders(get, {})).toBeNull();
    expect(ipFromHeaders(get, { TRUSTED_PROXY: "1" })).toBe("203.0.113.9");
    expect(ipHash("1.2.3.4", "a")).not.toBe(ipHash("1.2.3.4", "b"));
    expect(ipHash("1.2.3.4", "a")).not.toContain("1.2.3.4");
  });
});

describe("adaptateurs", () => {
  it("générique : mappage par défaut, chemins imbriqués, full name, champs personnalisés", () => {
    const [d] = adaptGeneric({ email: "a@b.fr", telephone: "0612345678", name: "Jean Marc Dupont", ville: "Lyon" }, {});
    expect(d).toMatchObject({ firstName: "Jean", lastName: "Marc Dupont", email: "a@b.fr", phone: "0612345678", city: "Lyon" });
    const [m] = adaptGeneric({ contact: { mail: "x@y.fr", list: [{ n: "Zed" }] }, budget: 5000 }, { "contact.mail": "email", "contact.list.0.n": "lastName", budget: "custom.budget_max" });
    expect(m).toMatchObject({ email: "x@y.fr", lastName: "Zed", custom: { budget_max: 5000 } });
  });
  it("générique : chemins dangereux et valeurs non scalaires ignorés", () => {
    expect(getPath({ a: 1 }, "__proto__.polluted")).toBeUndefined();
    expect(getPath({ a: { b: 2 } }, "a.b")).toBe(2);
    const [l] = adaptGeneric({ email: { $ne: "x" }, name: ["a"], phone: "06 12 34 56 78" }, {});
    expect(l!.email).toBeNull();
    expect(l!.phone).toBe("06 12 34 56 78");
  });
  it("Meta Lead Ads : entry/changes/leadgen field_data, plusieurs leads", () => {
    const fd = (n: string) => [{ name: "full_name", values: [`Marie ${n}`] }, { name: "email", values: [`m${n}@x.fr`] }, { name: "phone_number", values: ["+33600000000"] }, { name: "zip_code", values: ["75001"] }];
    const out = adaptMeta({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { field_data: fd("1") } }, { field: "autre", value: {} }, { field: "leadgen", value: { field_data: fd("2") } }] }] });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ firstName: "Marie", lastName: "1", email: "m1@x.fr", phone: "+33600000000", postalCode: "75001" });
    expect(adaptMeta({ field_data: fd("3") })).toHaveLength(1);
    expect(adaptMeta({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "1" } }] }] })).toHaveLength(0);
    expect(adaptMeta("nope")).toEqual([]);
  });
  it("Google Ads : user_column_data et google_key", () => {
    const body = { google_key: "k", user_column_data: [{ column_id: "FULL_NAME", string_value: "Paul Durand" }, { column_id: "EMAIL", string_value: "p@d.fr" }, { column_id: "PHONE_NUMBER", string_value: "0611223344" }, { column_id: "COMPANY_NAME", string_value: "Durand SA" }] };
    expect(adaptGoogle(body)[0]).toMatchObject({ firstName: "Paul", lastName: "Durand", email: "p@d.fr", company: "Durand SA" });
    expect(googleKeyOf(body)).toBe("k");
    expect(googleKeyOf({ google_key: 5 })).toBeNull();
    expect(adaptGoogle({})).toEqual([]);
  });
  it("configuration de mappage validée par Zod", () => {
    expect(mappingConfigSchema.safeParse({ "a.b": "email", c: "custom.budget" }).success).toBe(true);
    expect(mappingConfigSchema.safeParse({ "a b": "email" }).success).toBe(false);
    expect(mappingConfigSchema.safeParse({ a: "org_id" }).success).toBe(false);
    expect(mappingConfigSchema.safeParse({ a: "custom.A-B" }).success).toBe(false);
  });
  it("finalisation : e-mail/téléphone invalides, identité de repli, formules neutralisées", () => {
    const base = { firstName: "", lastName: "", email: null, phone: null, company: null, address: null, city: null, postalCode: null, value: null, custom: {} };
    expect(finalizeInbound({ ...base, lastName: "X", email: "pas-un-mail" })).toEqual({ ok: false, reason: "invalid_email" });
    expect(finalizeInbound({ ...base, lastName: "X", phone: "abc" })).toEqual({ ok: false, reason: "invalid_phone" });
    expect(finalizeInbound({ ...base, lastName: "X" })).toEqual({ ok: false, reason: "no_contact" });
    expect(finalizeInbound({ ...base, lastName: "X", email: "a,b@x.fr" })).toEqual({ ok: false, reason: "invalid_email" });
    const r = finalizeInbound({ ...base, email: "Solo@X.fr" });
    expect(r.ok && r.lead.lastName).toBe("solo@x.fr");
    const f = finalizeInbound({ ...base, lastName: "=HYPERLINK(1)", phone: "0611223344" });
    expect(f.ok && f.lead.lastName.startsWith("'=")).toBe(true);
  });
});

import { buildTestPayload, explainMapping } from "@/lib/inbound/adapters";
import { cronAuthorized } from "@/lib/cron";
import { decryptSecret, deriveEndpointSecret, encryptSecret, inboundKey, ipSalt, newEndpointSecret, verifyMetaSignature } from "@/lib/inbound/auth";
import { cleanText } from "@/lib/leads/normalize";
import { createHmac } from "node:crypto";

const KEY = "k".repeat(40);
const env = { INBOUND_SECRET_KEY: KEY };

describe("secret dérivé côté serveur (HKDF) et chiffrement AES-GCM", () => {
  const id1 = crypto.randomUUID();
  it("déterministe, distinct par endpoint, par version et par clé maîtresse", () => {
    const a = deriveEndpointSecret(id1, 1, env);
    expect(a).toBe(deriveEndpointSecret(id1, 1, env));
    expect(a).not.toBe(deriveEndpointSecret(id1, 2, env));
    expect(a).not.toBe(deriveEndpointSecret(crypto.randomUUID(), 1, env));
    expect(a).not.toBe(deriveEndpointSecret(id1, 1, { INBOUND_SECRET_KEY: "z".repeat(40) }));
    expect(a).toMatch(/^lfs_[A-Za-z0-9_-]{43}$/);
  });
  it("le hachage stocké ne permet ni de retrouver le secret ni de signer", () => {
    const n = newEndpointSecret(id1, 1, env);
    expect(n.hash).toBe(sha256Hex(n.secret));
    const body = "{}";
    const forgedKey = signPayload(n.hash, 1000, body);
    const real = signPayload(n.secret, 1000, body);
    expect(forgedKey).not.toBe(real);
    expect(verifyBodySignature(`t=1000,v1=${forgedKey}`, n.secret, body, 1001)).toBe(false);
    expect(verifyBodySignature(`t=1000,v1=${real}`, n.secret, body, 1001)).toBe(true);
  });
  it("clé maîtresse : exigée et solide en production, repli en développement", () => {
    expect(() => inboundKey({ NODE_ENV: "production" })).toThrow(/INBOUND_SECRET_KEY/);
    expect(() => inboundKey({ NODE_ENV: "production", INBOUND_SECRET_KEY: "court" })).toThrow();
    expect(() => inboundKey({ NODE_ENV: "production", INBOUND_SECRET_KEY: "leadforge-dev-inbound-key-not-for-production" })).toThrow();
    expect(inboundKey({ NODE_ENV: "production", INBOUND_SECRET_KEY: KEY })).toHaveLength(40);
    expect(inboundKey({ NODE_ENV: "development" }).length).toBeGreaterThanOrEqual(32);
  });
  it("sel d'IP : obligatoire en production", () => {
    expect(() => ipSalt({ NODE_ENV: "production" })).toThrow();
    expect(() => ipSalt({ NODE_ENV: "production", WEBHOOK_SIGNING_SALT: "dev-insecure-salt" })).toThrow();
    expect(ipSalt({ NODE_ENV: "production", WEBHOOK_SIGNING_SALT: "s".repeat(32) })).toBe("s".repeat(32));
  });
  it("AES-256-GCM : aller-retour, aléa, falsification et mauvaise clé détectées", () => {
    const blob = encryptSecret("app-secret-meta", env);
    expect(blob).not.toContain("app-secret-meta");
    expect(blob).not.toBe(encryptSecret("app-secret-meta", env));
    expect(decryptSecret(blob, env)).toBe("app-secret-meta");
    expect(decryptSecret(blob, { INBOUND_SECRET_KEY: "z".repeat(40) })).toBeNull();
    const parts = blob.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptSecret(parts.join("."), env)).toBeNull();
    expect(decryptSecret("n'importe quoi", env)).toBeNull();
  });
  it("signature Meta X-Hub-Signature-256", () => {
    const body = '{"entry":[]}';
    const good = `sha256=${createHmac("sha256", "appsecret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(good, "appsecret", body)).toBe(true);
    expect(verifyMetaSignature(good, "autre", body)).toBe(false);
    expect(verifyMetaSignature(good, "appsecret", body + " ")).toBe(false);
    expect(verifyMetaSignature(null, "appsecret", body)).toBe(false);
    expect(verifyMetaSignature("sha256=zz", "appsecret", body)).toBe(false);
  });
});

describe("mappage, charge de test, caractères dangereux, cron", () => {
  it("explainMapping : messages FR lisibles (pas de Zod brut)", () => {
    expect(explainMapping({ "a.b": "email" })).toBeNull();
    expect(explainMapping({ a: "notafield" })).toMatch(/champ « notafield » inconnu.*Champs possibles/);
    expect(explainMapping({ "a b": "email" })).toMatch(/chemin JSON/);
    expect(explainMapping({ a: "custom.A-B" })).toMatch(/inconnu/);
  });
  it("charge de test conforme au mappage personnalisé (chemins imbriqués)", () => {
    const body = buildTestPayload("generic", { "contact.email": "email", "contact.name": "fullName", montant: "value" }, 42) as Record<string, unknown>;
    expect(body).toMatchObject({ contact: { email: "test+42@leadforge.example", name: "Test LeadForge 42" }, montant: 1000 });
    const [lead] = adaptGeneric(body, { "contact.email": "email", "contact.name": "fullName", montant: "value" });
    expect(finalizeInbound(lead!).ok).toBe(true);
    const def = buildTestPayload("generic", {}, 7);
    expect(finalizeInbound(adaptGeneric(def, {})[0]!).ok).toBe(true);
    expect(finalizeInbound(adaptMeta(buildTestPayload("meta", {}, 1))[0]!).ok).toBe(true);
    expect(finalizeInbound(adaptGoogle(buildTestPayload("google", {}, 1))[0]!).ok).toBe(true);
  });
  it("bidi retirés ; formules neutralisées dans les champs personnalisés entrants ; e-mail commençant par = ou + refusé", () => {
    expect(cleanText("Jean‮nomiw")).toBe("Jeannomiw");
    const base = { firstName: "", lastName: "X", email: null, phone: "0611223344", company: null, address: null, city: null, postalCode: null, value: null };
    const r = finalizeInbound({ ...base, custom: { note: "=CMD()", n: 5 } });
    expect(r.ok && r.lead.custom).toEqual({ note: "'=CMD()", n: 5 });
    expect(finalizeInbound({ ...base, custom: {}, email: "+a@b.fr" })).toEqual({ ok: false, reason: "invalid_email" });
    expect(finalizeInbound({ ...base, custom: {}, email: "=a@b.fr" })).toEqual({ ok: false, reason: "invalid_email" });
  });
  it("cronAuthorized : secret requis (16+), Bearer exact, temps constant", () => {
    const secret = "s".repeat(32);
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronAuthorized(null, secret)).toBe(false);
    expect(cronAuthorized("Basic abc", secret)).toBe(false);
    expect(cronAuthorized(`Bearer ${secret}`, undefined)).toBe(false);
    expect(cronAuthorized("Bearer court", "court")).toBe(false);
  });
});
