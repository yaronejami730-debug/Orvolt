import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ, PRICING_FAQ } from "@/components/marketing/faq-data";
import { PLAN_LIST, PLANS } from "@/lib/billing/plans";
import { isPublicPath } from "@/lib/supabase/middleware";
import { NOINDEX_PAGES, PRIVATE_PREFIXES, PUBLIC_PAGES, SEO_FILES, SITE_NAME, absoluteUrl, isPrivatePath, siteUrl } from "@/lib/site";
import { breadcrumbSchema, faqSchema, graph, organizationSchema, pageMetadata, planOffers, serializeJsonLd, softwareSchema, websiteSchema } from "@/lib/seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { GET as llms } from "@/app/llms.txt/route";

const SRC = path.resolve(__dirname, "../../src");
type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const rules = () => robots().rules as Rule[];
const asArray = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

describe("robots.txt", () => {
  it("autorise les robots publics et les robots d'IA légitimes, avec la même exclusion de l'espace privé", () => {
    const agents = rules().flatMap((r) => asArray(r.userAgent));
    for (const bot of ["*", "Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) expect(agents, bot).toContain(bot);
    for (const r of rules()) {
      expect(asArray(r.allow)).toContain("/");
      expect(asArray(r.disallow)).toEqual(PRIVATE_PREFIXES);
      expect(asArray(r.disallow)).not.toContain("/");
    }
  });
  it("ne bloque aucune page publique ni la connexion (le noindex doit pouvoir être lu), et indique le sitemap", () => {
    const blocked = asArray(rules()[0].disallow);
    for (const p of [...PUBLIC_PAGES.map((x) => x.path), ...NOINDEX_PAGES, ...SEO_FILES]) expect(blocked.some((b) => (b.endsWith("/") ? p.startsWith(b) : p === b || p.startsWith(`${b}/`))), p).toBe(false);
    expect(robots().sitemap).toBe(`${siteUrl()}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  const entries = sitemap();
  it("contient toutes les pages publiques, une seule fois, en URL absolue", () => {
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const p of PUBLIC_PAGES) expect(urls).toContain(absoluteUrl(p.path));
    expect(urls).toHaveLength(PUBLIC_PAGES.length);
    for (const u of urls) expect(u.startsWith(siteUrl())).toBe(true);
    for (const p of ["/fonctionnalites", "/solutions/installateurs-energie", "/solutions/regies-prospection", "/pricing", "/cgv", "/mentions-legales", "/confidentialite"]) expect(urls).toContain(absoluteUrl(p));
  });
  it("ne liste ni page privée, ni connexion, ni inscription, ni page noindex", () => {
    for (const e of entries) {
      const p = new URL(e.url).pathname;
      expect(isPrivatePath(p), p).toBe(false);
      expect(NOINDEX_PAGES, p).not.toContain(p);
    }
  });
  it("donne de vraies dates de modification (passées, au format AAAA-MM-JJ)", () => {
    for (const e of entries) {
      expect(String(e.lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(String(e.lastModified)).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});

describe("pages publiques : title, description, accès", () => {
  it("titres uniques de 60 caractères au plus, descriptions uniques de 110 à 160 caractères", () => {
    expect(new Set(PUBLIC_PAGES.map((p) => p.title)).size).toBe(PUBLIC_PAGES.length);
    expect(new Set(PUBLIC_PAGES.map((p) => p.description)).size).toBe(PUBLIC_PAGES.length);
    for (const p of PUBLIC_PAGES) {
      expect(p.title.length, p.title).toBeLessThanOrEqual(60);
      expect(p.description.length, p.description).toBeGreaterThanOrEqual(110);
      expect(p.description.length, p.description).toBeLessThanOrEqual(160);
    }
  });
  it("chaque page publique, page noindex et fichier SEO est joignable sans connexion ; aucune zone privée ne l'est par erreur", () => {
    for (const p of [...PUBLIC_PAGES.map((x) => x.path), ...NOINDEX_PAGES, ...SEO_FILES]) expect(isPublicPath(p), p).toBe(true);
    for (const p of PUBLIC_PAGES) expect(isPrivatePath(p.path), p.path).toBe(false);
    for (const p of ["/dashboard", "/leads/abc", "/agenda/repartition", "/settings/billing", "/tasks", "/confirmation", "/onboarding/plan"]) expect(isPublicPath(p), p).toBe(false);
  });
  it("tout dossier racine de l'application figure dans PRIVATE_PREFIXES (sinon pas de noindex)", () => {
    const dirs = (dir: string) => readdirSync(path.join(SRC, "app", dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`);
    const roots = [...dirs("(app)"), ...dirs("(onboarding)"), "/no-access", "/design", "/api/x"];
    for (const r of roots) expect(isPrivatePath(r), r).toBe(true);
  });
  it("metadata : canonical = chemin de la page, hreflang fr-FR, Open Graph et Twitter cohérents", () => {
    for (const p of PUBLIC_PAGES) {
      const m = pageMetadata(p.path);
      expect(m.alternates?.canonical).toBe(p.path);
      expect(m.alternates?.languages).toMatchObject({ "fr-FR": p.path });
      expect(m.openGraph).toMatchObject({ url: p.path, title: p.title, description: p.description, locale: "fr_FR", siteName: SITE_NAME });
      expect(m.twitter).toMatchObject({ card: "summary_large_image", title: p.title });
      expect(m.robots).toBeUndefined(); // jamais de noindex accidentel sur une page publique
    }
    expect(() => pageMetadata("/inconnue")).toThrow();
  });
});

describe("pages : noindex là où il faut, nulle part ailleurs", () => {
  const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
  it("les pages publiques indexables n'ont aucun noindex dans leur source", () => {
    for (const rel of ["app/(marketing)/page.tsx", "app/(marketing)/pricing/page.tsx", "app/(marketing)/cgv/page.tsx", "app/(marketing)/mentions-legales/page.tsx", "app/(marketing)/confidentialite/page.tsx", "app/(marketing)/fonctionnalites/page.tsx", "app/(marketing)/solutions/installateurs-energie/page.tsx", "app/(marketing)/solutions/regies-prospection/page.tsx", "app/layout.tsx"]) {
      expect(read(rel), rel).not.toMatch(/index:\s*false/);
      if (!rel.endsWith("layout.tsx")) expect(read(rel), rel).toContain("pageMetadata(");
    }
  });
  it("connexion, inscription, mot de passe et demande de rappel sont noindex", () => {
    expect(read("app/(auth)/layout.tsx")).toContain("NOINDEX_METADATA");
    expect(read("app/(landing)/contact/page.tsx")).toMatch(/index:\s*false/);
    expect(read("middleware.ts")).toContain("X-Robots-Tag");
  });
});

describe("données structurées JSON-LD", () => {
  const all = graph(organizationSchema(), websiteSchema(), softwareSchema(), faqSchema(FAQ), breadcrumbSchema([{ name: "Accueil", path: "/" }, { name: "Tarifs", path: "/pricing" }]));
  it("se sérialise en JSON valide, @context schema.org, @graph de nœuds typés", () => {
    const parsed = JSON.parse(JSON.stringify(all));
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication", "FAQPage", "BreadcrumbList"]);
  });
  it("n'invente aucun avis, note, réseau social, adresse ni téléphone", () => {
    const json = JSON.stringify(all);
    for (const bad of ["aggregateRating", "ratingValue", "reviewCount", "review", "sameAs", "telephone", "address"]) expect(json, bad).not.toContain(bad);
  });
  it("l'organisation a un nom, une URL et un logo en image", () => {
    const o = organizationSchema();
    expect(o).toMatchObject({ "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") });
    expect(o.logo.url).toBe(`${siteUrl()}/icon.png`);
  });
  it("les offres reprennent EXACTEMENT les prix de PLANS (mensuel et annuel)", () => {
    const offers = planOffers();
    expect(offers).toHaveLength(PLAN_LIST.length * 2);
    for (const p of PLAN_LIST) {
      const month = offers.find((o) => o.name === `${p.name} mensuel`)!;
      const year = offers.find((o) => o.name === `${p.name} annuel`)!;
      expect(month.price).toBe((PLANS[p.id].priceCents / 100).toFixed(2));
      expect(year.price).toBe((PLANS[p.id].yearlyPriceCents / 100).toFixed(2));
      for (const o of [month, year]) {
        expect(o.priceCurrency).toBe("EUR");
        expect(o.priceSpecification.price).toBe(o.price);
      }
    }
  });
  it("FAQPage = exactement les questions et réponses affichées", () => {
    for (const items of [FAQ, PRICING_FAQ]) {
      const s = faqSchema(items);
      expect(s.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(items.map((f) => [f.q, f.a]));
    }
  });
  it("fil d'Ariane : positions 1..n et URL absolues", () => {
    const b = breadcrumbSchema([{ name: "Accueil", path: "/" }, { name: "Tarifs", path: "/pricing" }]);
    expect(b.itemListElement.map((i) => [i.position, i.item])).toEqual([[1, absoluteUrl("/")], [2, absoluteUrl("/pricing")]]);
  });
  it("serializeJsonLd échappe `<` et les séparateurs Unicode, et reste du JSON parseable", () => {
    const data = { a: "</script><b>", b: "x\u2028y\u2029z" };
    const out = serializeJsonLd(data);
    expect(out).not.toContain("<");
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual(data);
  });
});

describe("paiement sécurisé : mentions vraies et présentes", () => {
  it("la FAQ de l'accueil et des tarifs répond à « Mes paiements sont-ils sécurisés ? »", () => {
    for (const list of [FAQ, PRICING_FAQ]) {
      const item = list.find((f) => f.q === "Mes paiements sont-ils sécurisés ?");
      expect(item?.a).toMatch(/Stripe/);
      expect(item?.a).toMatch(/PCI DSS niveau 1/);
      expect(item?.a).toMatch(/ne transitent pas par nos serveurs/);
      expect(item?.a).toMatch(/3-D Secure/);
    }
  });
  it("l'application ne manipule jamais de numéro de carte : aucun champ ni script de saisie de carte dans src", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/autoComplete=["']cc-number|name=["']card[-_]?number|loadStripe\(|@stripe\/react-stripe-js|payment_method_data|card\[number\]/i);
    }
    const checkout = readFileSync(path.join(SRC, "lib/billing/checkout.ts"), "utf8");
    expect(checkout).toContain('mode: "subscription"');
    expect(checkout).toContain("stripe.checkout.sessions.create"); // page de paiement hébergée par Stripe
    expect(checkout).toContain("billingPortal.sessions.create"); // carte, factures et résiliation côté Stripe
  });
  it("pied de page, CGV et confidentialité mentionnent Stripe", () => {
    const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
    expect(read("components/marketing/site-footer.tsx")).toContain("Paiements sécurisés par Stripe");
    expect(read("app/(marketing)/cgv/page.tsx")).toContain("PCI DSS niveau 1");
    expect(read("app/(marketing)/confidentialite/page.tsx")).toContain("sous-traitant");
    expect(read("components/marketing/pricing-section.tsx")).toContain("PaymentSecurity");
  });
});

describe("llms.txt", () => {
  it("liste toutes les pages publiques en URL absolue", async () => {
    const txt = await llms().text();
    expect(txt.startsWith(`# ${SITE_NAME}`)).toBe(true);
    for (const p of PUBLIC_PAGES) expect(txt).toContain(absoluteUrl(p.path));
  });
});
