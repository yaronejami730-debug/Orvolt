import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe("correctifs S7 (boucle 1)", () => {
  it("aucun texte « sans carte bancaire » : l'essai Checkout exige une carte", () => {
    const hits = walk(path.join(root, "src")).filter((f) => /\.(tsx?)$/.test(f) && /sans carte/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("lecture seule : liste blanche de portées de lecture ; toute autre portée est bloquée par guard et guardAny", () => {
    const src = read("src/lib/action-guard.ts");
    expect(src).toMatch(/READ_SCOPES = new Set\(\["leads-list", "agenda-list", "agenda-preview", "dispatch-preview", "notifications", "import-report", "webhook-test", "billing", "leads-file-url"\]\)/);
    expect(src.match(/!READ_SCOPES\.has\(scope\) && !\(await isWritable/g)).toHaveLength(2);
  });
  it("membres et rôles : écritures gardées côté serveur ; seule la désactivation passe en lecture seule", () => {
    const m = read("src/app/(app)/settings/members/actions.ts");
    expect(m.match(/isWritable\(s\.org\.id\)/g)!.length).toBeGreaterThanOrEqual(3);
    expect(m).toMatch(/parsed\.data\.status !== "disabled" && !\(await isWritable/);
    expect(read("src/app/(app)/settings/roles/actions.ts").match(/isWritable\(s\.org\.id\)/g)).toHaveLength(2);
  });
  it("Open Graph : image déclarée sur la landing et les tarifs ; URL du site depuis NEXT_PUBLIC_APP_URL", () => {
    expect(read("src/lib/seo.ts")).toContain('url: "/opengraph-image"'); // pageMetadata, utilisé par la landing et les tarifs
    expect(read("src/lib/site.ts")).toContain("NEXT_PUBLIC_APP_URL");
    expect(read(".env.example")).toMatch(/OBLIGATOIRE en production[^\n]*\nNEXT_PUBLIC_APP_URL=/);
  });
  it("Kanban mobile : cibles tactiles de 40 px (poignée, déplacement, éléments du menu)", () => {
    const k = read("src/components/leads/kanban-board.tsx");
    expect(k.match(/size-10/g)!.length).toBeGreaterThanOrEqual(2);
    expect(k).toContain('"min-h-10 sm:min-h-8"');
  });
  it("menu burger : Échap referme et rend le focus au bouton", () => {
    const h = read("src/components/marketing/site-header.tsx");
    expect(h).toContain('e.key !== "Escape"');
    expect(h).toContain("toggleRef.current?.focus()");
  });
});
