import { describe, expect, it } from "vitest";
import { MemoryStore, RULES, RateLimiter } from "@/lib/rate-limit";
import { campaignFromSearch, displayPhone, formatPhoneInput, normalizePhone, sanitizeCampaign, sanitizeLandingPath, sanitizePrefill, sanitizeReferrer, signupPrefillHref, splitFullName } from "@/lib/landing/fields";
import { hashIp } from "@/lib/landing/ip-hash";
import { submitTiming, validateLanding } from "@/lib/validation/landing";

const ok = { kind: "essai", firstName: "Marc", lastName: "Lefèvre", email: " Marc@Exemple.FR ", phone: "06 12 34 56 78" };

describe("téléphone", () => {
  it("normalise les numéros français et internationaux en E.164", () => {
    for (const [raw, e164] of [
      ["06 12 34 56 78", "+33612345678"], ["06.12.34.56.78", "+33612345678"], ["0612345678", "+33612345678"],
      ["+33 6 12 34 56 78", "+33612345678"], ["+33 (0)6 12 34 56 78", "+33612345678"], ["0033612345678", "+33612345678"],
      ["+32 470 12 34 56", "+32470123456"], ["+1 415 555 2671", "+14155552671"],
    ] as const) expect(normalizePhone(raw), raw).toEqual({ ok: true, e164 });
  });
  it("refuse les numéros invalides", () => {
    for (const raw of ["", "abc", "0012", "06 12 34", "00 12 34 56 78", "+0 123", "061234567890", "+33 12", "06 12 34 56 7a", "<script>"]) expect(normalizePhone(raw).ok, raw).toBe(false);
  });
  it("masque la saisie", () => {
    expect(formatPhoneInput("0612345678")).toBe("06 12 34 56 78");
    expect(formatPhoneInput("06123")).toBe("06 12 3");
    expect(formatPhoneInput("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(formatPhoneInput("0033612345678")).toBe("+33 6 12 34 56 78");
    expect(formatPhoneInput("+32470123456")).toBe("+324 701 234 56");
    expect(formatPhoneInput("06abc12")).toBe("06 12");
    expect(displayPhone("+33612345678")).toBe("06 12 34 56 78");
    expect(displayPhone("+32470123456")).toBe("+32470123456");
  });
});

describe("paramètres de campagne", () => {
  it("ne garde que les clés connues, bornées et assainies", () => {
    const c = sanitizeCampaign({ utm_source: "google", utm_medium: "cpc\n", utm_campaign: "x".repeat(500), gclid: "<b>g</b>", evil: "1", __proto__: { a: 1 }, utm_term: 42 });
    expect(Object.keys(c).sort()).toEqual(["gclid", "utm_campaign", "utm_medium", "utm_source"]);
    expect(c.utm_campaign).toHaveLength(200);
    expect(c.utm_medium).toBe("cpc");
    expect(c.gclid).not.toMatch(/[<>]/);
  });
  it("accepte du JSON, ignore le reste", () => {
    expect(sanitizeCampaign('{"fbclid":"abc"}')).toEqual({ fbclid: "abc" });
    for (const bad of ["not json", "[]", "null", 12, undefined, "x".repeat(5000)]) expect(sanitizeCampaign(bad)).toEqual({});
  });
  it("lit une query string", () => {
    expect(campaignFromSearch("?utm_source=meta&utm_medium=paid&foo=bar&gclid=")).toEqual({ utm_source: "meta", utm_medium: "paid" });
  });
  it("référent sans requête ni fragment ; page d'entrée limitée à /lp/", () => {
    expect(sanitizeReferrer("https://www.google.com/search?q=secret#x")).toBe("https://www.google.com/search");
    expect(sanitizeReferrer("javascript:alert(1)")).toBeNull();
    expect(sanitizeReferrer("")).toBeNull();
    expect(sanitizeLandingPath("/lp/essai")).toBe("/lp/essai");
    for (const bad of ["/dashboard", "//evil.com", "/lp/../x", "https://x.fr/lp/essai", undefined]) expect(sanitizeLandingPath(bad)).toBeNull();
  });
});

describe("préremplissage de /signup", () => {
  it("assainit les paramètres (jamais de confiance à l'URL)", () => {
    expect(sanitizePrefill({ email: "A@B.fr", firstName: "Marc<script>", lastName: ["Lefèvre", "x"] })).toEqual({ email: "a@b.fr", firstName: "Marc script", lastName: "Lefèvre" });
    expect(sanitizePrefill({ email: "pas-un-mail" }).email).toBe("");
    expect(sanitizePrefill({ firstName: "x".repeat(200) }).firstName).toHaveLength(60);
  });
  it("le lien ne contient ni téléphone ni campagne", () => {
    const href = signupPrefillHref({ email: "m@e.fr", firstName: "Marc", lastName: "Le Fèvre" });
    expect(href).toMatch(/^\/signup\?/);
    expect(href).not.toMatch(/phone|utm|gclid/);
    expect(new URLSearchParams(href.split("?")[1]).get("lastName")).toBe("Le Fèvre");
  });
  it("sépare prénom et nom", () => {
    expect(splitFullName("Jean-Pierre De La Tour")).toEqual({ firstName: "Jean-Pierre", lastName: "De La Tour" });
  });
});

describe("validation du formulaire", () => {
  it("accepte un essai valide et normalise", () => {
    const r = validateLanding(ok);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.email).toBe("marc@exemple.fr"); expect(r.data.phoneE164).toBe("+33612345678"); }
  });
  it("erreurs inline en français", () => {
    const r = validateLanding({ kind: "essai", firstName: "", lastName: "", email: "x", phone: "12" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors).toMatchObject({ firstName: "Prénom requis.", lastName: "Nom requis.", email: "Adresse e-mail invalide.", phone: "Numéro de téléphone invalide." });
  });
  it("le rappel exige le consentement", () => {
    const base = { ...ok, kind: "rappel", slot: "matin" };
    const refused = validateLanding(base);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.fieldErrors.consent).toMatch(/accepter/);
    expect(validateLanding({ ...base, consent: "on" }).ok).toBe(true);
    expect(validateLanding({ ...base, consent: "true" }).ok).toBe(false);
  });
  it("refuse un type, un créneau ou un métier inconnus", () => {
    expect(validateLanding({ ...ok, kind: "autre" }).ok).toBe(false);
    expect(validateLanding({ ...ok, kind: "rappel", consent: "on", slot: "nuit" }).ok).toBe(false);
    expect(validateLanding({ ...ok, trade: "hack" }).ok).toBe(false);
    expect(validateLanding({ ...ok, trade: "regies" }).ok).toBe(true);
  });
  it("assainit campagne, référent et page", () => {
    const r = validateLanding({ ...ok, campaign: JSON.stringify({ utm_source: "g", x: "y" }), referrer: "https://a.fr/p?q=1", landingPath: "/evil" });
    expect(r.ok && r.data.campaign).toEqual({ utm_source: "g" });
    expect(r.ok && r.data.referrer).toBe("https://a.fr/p");
    expect(r.ok && r.data.landingPath).toBeNull();
  });
});

describe("anti-robot", () => {
  it("délai minimal : absent, trop récent ou invalide = refusé", () => {
    const now = 1_000_000;
    expect(submitTiming(String(now - 500), now)).toBe("too_fast");
    expect(submitTiming(String(now - 5000), now)).toBe("ok");
    for (const bad of [undefined, "", "abc", "0", String(now + 10_000)]) expect(submitTiming(bad, now), String(bad)).toBe("too_fast");
  });
  it("IP hachée avec un sel, jamais en clair ; sans sel ou sans IP : rien", () => {
    const h = hashIp("203.0.113.7", "sel-secret");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203");
    expect(hashIp("203.0.113.7", "autre-sel")).not.toBe(h);
    expect(hashIp("203.0.113.7", "sel-secret")).toBe(h);
    expect(hashIp(null, "sel-secret")).toBeNull();
    expect(hashIp("203.0.113.7", "")).toBeNull();
  });
  it("limitation de débit : par IP, par e-mail et plafond global", async () => {
    const t = 0;
    const l = new RateLimiter(new MemoryStore(), () => t);
    for (let i = 0; i < RULES.landing.limit; i++) expect((await l.check("landing:1.2.3.4", RULES.landing)).ok).toBe(true);
    expect((await l.check("landing:1.2.3.4", RULES.landing)).ok).toBe(false);
    expect((await l.check("landing:5.6.7.8", RULES.landing)).ok).toBe(true);
    for (let i = 0; i < RULES.landingEmail.limit; i++) expect((await l.check("landing-email:a@b.fr", RULES.landingEmail)).ok).toBe(true);
    expect((await l.check("landing-email:a@b.fr", RULES.landingEmail)).ok).toBe(false);
    expect(RULES.landingGlobal.limit).toBeGreaterThan(RULES.landing.limit);
  });
});
