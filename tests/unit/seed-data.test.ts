import { describe, expect, it } from "vitest";
import { DAY, DEMO_DOMAIN, DEMO_PASSWORD, DEMO_USERS, ORG_SPECS, demoPhone, generateOrg, makeRng, type GenOrg } from "../../scripts/seed/data";
import { assertLocalTarget } from "../../scripts/seed/seed";
import { getTemplate } from "@/lib/templates";

const NOW = new Date("2026-10-25T10:00:00Z");
const gen = (i: number): GenOrg => {
  const spec = ORG_SPECS[i]!;
  const tpl = getTemplate(spec.templateId)!;
  return generateOrg({ spec, statuses: tpl.statuses.map((s) => ({ key: s.key, name: s.name, kind: s.kind, initial: s.initial })), transitions: tpl.transitions, now: NOW });
};
const orgs = [gen(0), gen(1)];
const allLeads = orgs.flatMap((o) => o.leads);

describe("données de démonstration", () => {
  it("6 comptes, 200 leads au total, mot de passe documenté", () => {
    expect(DEMO_USERS).toHaveLength(7);
    expect(new Set(DEMO_USERS.map((u) => u.email)).size).toBe(7);
    expect(DEMO_USERS.every((u) => u.email.endsWith(`@${DEMO_DOMAIN}`))).toBe(true);
    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(8);
    expect(orgs.map((o) => o.leads.length)).toEqual([120, 80]);
    expect(allLeads).toHaveLength(200);
  });

  it("jeu de rôles : Super administrateur, Administrateur, Prospecteur, Confirmateur, Commercial présents", () => {
    const roles = new Set(DEMO_USERS.flatMap((u) => Object.values(u.orgs)));
    expect([...roles].sort()).toEqual(["Administrateur", "Commercial", "Confirmateur", "Prospecteur", "Super administrateur"]);
  });

  it("contacts fictifs : e-mail @example.test, téléphone en plage 06 39 98, aucun doublon par organisation", () => {
    for (const o of orgs) {
      expect(new Set(o.leads.map((l) => l.email)).size).toBe(o.leads.length);
      expect(new Set(o.leads.map((l) => l.phone)).size).toBe(o.leads.length);
      for (const l of o.leads) {
        expect(l.email).toMatch(/^[a-z]+\.[a-z]+\d+@example\.test$/);
        expect(l.phone).toMatch(/^06 39 98 \d\d \d\d$/);
        expect(l.postal_code).toMatch(/^\d{5}$/);
        expect(Math.abs(l.lat)).toBeLessThanOrEqual(90);
      }
    }
    expect(demoPhone(12345)).toBe("06 39 98 23 45");
  });

  it("chronologie cohérente : 90 jours, transitions croissantes, rien dans le futur", () => {
    for (const l of allLeads) {
      expect(l.createdAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 90 * DAY);
      expect(l.createdAt.getTime()).toBeLessThan(NOW.getTime());
      let prev = l.createdAt.getTime();
      for (const t of l.transitions) {
        expect(t.at.getTime()).toBeGreaterThan(prev);
        expect(t.at.getTime()).toBeLessThanOrEqual(NOW.getTime());
        prev = t.at.getTime();
      }
      expect(l.updatedAt.getTime()).toBe(prev);
      for (const n of l.notes) expect(n.at.getTime()).toBeLessThanOrEqual(NOW.getTime());
      for (const c of l.calls) expect(c.at.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("statuts répartis : tous représentés, gagnés et perdus finalement cohérents avec l'historique", () => {
    for (const [i, o] of orgs.entries()) {
      const tpl = getTemplate(ORG_SPECS[i]!.templateId)!;
      const used = new Set(o.leads.map((l) => l.statusKey));
      expect(used.size).toBe(tpl.statuses.length);
      for (const l of o.leads) {
        const last = l.transitions.at(-1);
        if (last) expect(last.toKey).toBe(l.statusKey);
        else expect(l.statusKey).toBe(tpl.statuses.find((s) => s.initial)!.key);
        // une chaîne ininterrompue de transitions
        l.transitions.forEach((t, k) => k > 0 && expect(t.fromKey).toBe(l.transitions[k - 1]!.toKey));
      }
    }
  });

  it("rendez-vous : passés réalisés, futurs planifiés, pas de chevauchement, hors rayon avec dérogation", () => {
    const appts = allLeads.flatMap((l) => l.appointments.map((a) => ({ a, l })));
    expect(appts.length).toBeGreaterThan(50);
    expect(appts.some(({ a }) => a.status === "done" && a.startsAt < NOW)).toBe(true);
    expect(appts.some(({ a }) => ["planned", "confirmed"].includes(a.status) && a.startsAt > NOW)).toBe(true);
    for (const { a } of appts) {
      if (a.startsAt > NOW) expect(["planned", "confirmed"]).toContain(a.status);
      if (a.distanceStatus === "over_radius") {
        expect(a.override).toBe(true);
        expect((a.overrideReason ?? "").length).toBeGreaterThanOrEqual(3);
      }
    }
    expect(appts.filter(({ a }) => a.distanceStatus === "over_radius").length).toBeGreaterThanOrEqual(3);
    for (const o of orgs) {
      const slots = o.leads.flatMap((l) => l.appointments).filter((a) => a.status !== "cancelled").map((a) => `${a.assignedKey}@${a.startsAt.toISOString()}`);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  it("zones : coordonnées pré-remplies, rayon valide", () => {
    for (const o of orgs) {
      expect(o.zones.length).toBeGreaterThan(0);
      for (const z of o.zones) {
        expect(z.radiusKm).toBeGreaterThanOrEqual(5);
        expect(z.radiusKm).toBeLessThanOrEqual(200);
        expect(Number.isFinite(z.lat) && Number.isFinite(z.lng)).toBe(true);
      }
    }
  });

  it("déterministe : même graine, mêmes données", () => {
    expect(JSON.stringify(gen(0))).toBe(JSON.stringify(gen(0)));
  });

  it("champs personnalisés conformes au template", () => {
    const keys = (i: number) => new Set(getTemplate(ORG_SPECS[i]!.templateId)!.fields.map((f) => f.key));
    for (const [i, o] of orgs.entries()) for (const l of o.leads) for (const k of Object.keys(l.custom)) expect(keys(i).has(k)).toBe(true);
  });

  it("générateur aléatoire et garde-fou de cible", () => {
    const r = makeRng(1);
    expect(makeRng(1).next()).toBe(r.next());
    expect(() => assertLocalTarget("http://127.0.0.1:56321", {} as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertLocalTarget("https://abc.supabase.co", {} as NodeJS.ProcessEnv)).toThrow(/refusé/);
    expect(() => assertLocalTarget("https://abc.supabase.co", { ALLOW_REMOTE_SEED: "1" } as unknown as NodeJS.ProcessEnv)).toThrow(/confirmation/);
    expect(() => assertLocalTarget("https://abc.supabase.co", { ALLOW_REMOTE_SEED: "1", CONFIRM_REMOTE_SEED: "abc.supabase.co" } as unknown as NodeJS.ProcessEnv)).not.toThrow();
  });
});
