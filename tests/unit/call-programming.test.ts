import { describe, expect, it } from "vitest";
import {
  assignmentInputSchema, assignmentStatus, describeWindow, domainInputSchema, findAmbiguousOverlaps, isDuplicate, localParts, memberDomainsInputSchema,
  normalizeAssignment, resolveScriptsForMember, windowCovers, type Assignment, type CallDomain, type ScriptLite,
} from "@/lib/call-programming";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PAC = id(100), PV = id(101), ISO = id(102);
const domains: CallDomain[] = [
  { id: PAC, name: "Pompe à chaleur", color: null, active: true, position: 0 },
  { id: PV, name: "Photovoltaïque", color: null, active: true, position: 1 },
  { id: ISO, name: "Isolation", color: null, active: false, position: 2 },
];
const script = (n: number, o: Partial<ScriptLite> = {}): ScriptLite => ({ id: id(n), name: `F${n}`, active: true, domainId: null, position: n, ...o });
const asg = (n: number, scriptN: number, o: Partial<Assignment> = {}): Assignment => ({
  id: id(1000 + n), scriptId: id(scriptN), scope: "all", userId: null, domainId: null, startsOn: null, endsOn: null, days: null, timeFrom: null, timeTo: null, active: true, priority: 0, ...o,
});
const U1 = "user-1", U2 = "user-2";
const NOW = new Date("2026-03-11T10:30:00Z"); // mercredi 11 h 30 à Paris (UTC+1)
const names = (r: ReturnType<typeof resolveScriptsForMember>) => r.scripts.map((s) => s.name);
const run = (o: Partial<Parameters<typeof resolveScriptsForMember>[0]> & { scripts: ScriptLite[]; assignments: Assignment[] }) =>
  resolveScriptsForMember({ member: { userId: U1, domainIds: [] }, domains, lead: null, now: NOW, ...o });

describe("résolution des formulaires", () => {
  const scripts = [script(1, { domainId: PAC }), script(2, { domainId: PV }), script(3)];
  const assignments = [asg(1, 1, { scope: "domain", domainId: PAC }), asg(2, 2, { scope: "domain", domainId: PV }), asg(3, 3, { scope: "all" })];

  it("membre sans domaine : seulement ce qui est pour tout le monde", () => {
    expect(names(run({ scripts, assignments }))).toEqual(["F3"]);
  });
  it("membre d'un domaine : son domaine puis le générique", () => {
    const r = run({ scripts, assignments, member: { userId: U1, domainIds: [PAC] } });
    expect(names(r)).toEqual(["F1", "F3"]);
    expect(r.defaultScript?.name).toBe("F1");
    expect(r.scripts[0].reason).toBe("member_domain");
  });
  it("plusieurs domaines : tous visibles, ordre par position", () => {
    expect(names(run({ scripts, assignments, member: { userId: U1, domainIds: [PV, PAC] } }))).toEqual(["F1", "F2", "F3"]);
  });
  it("domaine du lead : son formulaire passe en premier", () => {
    const r = run({ scripts, assignments, member: { userId: U1, domainIds: [PAC, PV] }, lead: { domainId: PV } });
    expect(names(r)).toEqual(["F2", "F1", "F3"]);
    expect(r.scripts[0].reason).toBe("lead_domain");
  });
  it("domaine du lead inactif ou inconnu : ignoré", () => {
    expect(names(run({ scripts, assignments, member: { userId: U1, domainIds: [PAC] }, lead: { domainId: ISO } }))).toEqual(["F1", "F3"]);
  });
  it("affectation à un membre précis : l'autre membre ne voit rien", () => {
    const a = [asg(1, 1, { scope: "member", userId: U1 })];
    const sc = [script(1)];
    expect(names(run({ scripts: sc, assignments: a }))).toEqual(["F1"]);
    expect(names(run({ scripts: sc, assignments: a, member: { userId: U2, domainIds: [] } }))).toEqual([]);
  });
  it("formulaire jamais programmé : ouvert à tous ; inactif : jamais", () => {
    expect(names(run({ scripts: [script(1), script(2, { active: false })], assignments: [] }))).toEqual(["F1"]);
  });
  it("affectation inactive ou domaine inactif : n'ouvre rien", () => {
    expect(names(run({ scripts: [script(1)], assignments: [asg(1, 1, { active: false })] }))).toEqual([]);
    expect(names(run({ scripts: [script(1)], assignments: [asg(1, 1, { scope: "domain", domainId: ISO })], member: { userId: U1, domainIds: [ISO] } }))).toEqual([]);
  });
  it("période passée, en cours, future (bornes incluses)", () => {
    const f = (o: Partial<Assignment>) => names(run({ scripts: [script(1)], assignments: [asg(1, 1, o)] }));
    expect(f({ startsOn: "2026-01-01", endsOn: "2026-03-10" })).toEqual([]);
    expect(f({ startsOn: "2026-03-12" })).toEqual([]);
    expect(f({ startsOn: "2026-03-11", endsOn: "2026-03-11" })).toEqual(["F1"]);
    expect(f({ endsOn: "2026-12-31" })).toEqual(["F1"]);
  });
  it("jours de la semaine et plage horaire locale", () => {
    const f = (o: Partial<Assignment>) => names(run({ scripts: [script(1)], assignments: [asg(1, 1, o)] }));
    expect(f({ days: [1, 2] })).toEqual([]); // mercredi
    expect(f({ days: [3] })).toEqual(["F1"]);
    expect(f({ timeFrom: "09:00", timeTo: "11:30" })).toEqual([]); // 11:30 exclu
    expect(f({ timeFrom: "11:00", timeTo: "12:00" })).toEqual(["F1"]);
    expect(f({ days: [3], timeFrom: "14:00", timeTo: "18:00" })).toEqual([]);
  });
  it("heure d'été : 11 h 30 locale en juillet = 09:30 UTC", () => {
    const summer = new Date("2026-07-15T09:30:00Z");
    expect(localParts(summer)).toMatchObject({ date: "2026-07-15", seconds: 11 * 3600 + 30 * 60, dow: 3 });
    const w = { startsOn: null, endsOn: null, days: null, timeFrom: "11:00", timeTo: "12:00" };
    expect(windowCovers(w, summer)).toBe(true);
    expect(windowCovers(w, new Date("2026-07-15T10:30:00Z"))).toBe(false); // 12 h 30 locale
    expect(windowCovers(w, new Date("2026-01-15T10:30:00Z"))).toBe(true); // hiver : 11 h 30 locale
  });
  it("passage à l'heure d'été : le jour local suit Paris, pas UTC", () => {
    // 29 mars 2026, 00:30 UTC = 01:30 Paris (avant le saut) ; 22:30 UTC le 28 = 23:30 Paris le 28
    expect(localParts(new Date("2026-03-28T22:30:00Z")).date).toBe("2026-03-28");
    expect(localParts(new Date("2026-03-28T23:30:00Z")).date).toBe("2026-03-29");
    expect(localParts(new Date("2026-03-29T01:30:00Z")).seconds).toBe(3 * 3600 + 30 * 60); // 03:30 après le saut
  });
  it("priorité : la plus haute passe en premier, puis spécificité", () => {
    const sc = [script(1), script(2)];
    const a = [asg(1, 1, { priority: 1 }), asg(2, 2, { priority: 5 })];
    expect(names(run({ scripts: sc, assignments: a }))).toEqual(["F2", "F1"]);
    const b = [asg(1, 1, { scope: "all" }), asg(2, 2, { scope: "member", userId: U1 })];
    expect(names(run({ scripts: sc, assignments: b }))).toEqual(["F2", "F1"]);
  });
  it("une seule apparition par formulaire malgré plusieurs affectations", () => {
    const a = [asg(1, 1, { priority: 1 }), asg(2, 1, { priority: 9 })];
    const r = run({ scripts: [script(1)], assignments: a });
    expect(r.scripts).toHaveLength(1);
    expect(r.scripts[0].assignmentId).toBe(id(1002));
  });
  it("gérant (seeAll) ou hors plan Pro : tous les formulaires actifs", () => {
    const sc = [script(1), script(2), script(3, { active: false })];
    const a = [asg(1, 1, { scope: "member", userId: U2 })];
    expect(names(run({ scripts: sc, assignments: a, seeAll: true }))).toEqual(["F1", "F2"]);
    expect(names(run({ scripts: sc, assignments: a, programming: false }))).toEqual(["F1", "F2"]);
    expect(names(run({ scripts: sc, assignments: a }))).toEqual(["F2"]);
  });
});

describe("validation de la programmation", () => {
  const base = { scriptId: id(1), scope: "all" as const };
  it("accepte une programmation simple et normalise les jours", () => {
    const p = assignmentInputSchema.parse({ ...base, days: [5, 1, 3], timeFrom: "09:00", timeTo: "12:00", startsOn: "2026-03-01", endsOn: "" });
    expect(normalizeAssignment(p)).toMatchObject({ days: [1, 3, 5], endsOn: null, startsOn: "2026-03-01", priority: 0, active: true });
  });
  it("refuse une période incohérente, une plage horaire incohérente, une cible manquante", () => {
    const bad = (o: object) => assignmentInputSchema.safeParse({ ...base, ...o }).success;
    expect(bad({ startsOn: "2026-03-10", endsOn: "2026-03-01" })).toBe(false);
    expect(bad({ startsOn: "2026-02-31" })).toBe(false);
    expect(bad({ timeFrom: "12:00", timeTo: "09:00" })).toBe(false);
    expect(bad({ timeFrom: "09:00" })).toBe(false);
    expect(bad({ scope: "member" })).toBe(false);
    expect(bad({ scope: "domain" })).toBe(false);
    expect(bad({ scope: "member", userId: id(7), domainId: id(8) })).toBe(false);
    expect(bad({ days: [0] })).toBe(false);
    expect(bad({ days: [1, 1] })).toBe(false);
    expect(bad({ priority: 101 })).toBe(false);
    expect(bad({ scope: "member", userId: id(7) })).toBe(true);
  });
  it("détecte le doublon exact", () => {
    const a = normalizeAssignment(assignmentInputSchema.parse({ ...base, days: [2, 1] }));
    const e = [{ ...a, id: id(1) }];
    expect(isDuplicate(normalizeAssignment(assignmentInputSchema.parse({ ...base, days: [1, 2] })), e)).toBe(true);
    expect(isDuplicate(normalizeAssignment(assignmentInputSchema.parse({ ...base, days: [1] })), e)).toBe(false);
    expect(isDuplicate(a, e, id(1))).toBe(false);
  });
  it("signale un chevauchement ambigu seulement à priorité égale", () => {
    const mk = (o: object) => normalizeAssignment(assignmentInputSchema.parse({ scope: "all", scriptId: id(2), ...o }));
    const existing = [{ ...mk({ scriptId: id(1), days: [1, 2, 3] }), id: id(1) }];
    expect(findAmbiguousOverlaps(mk({ days: [3, 4] }), existing)).toHaveLength(1);
    expect(findAmbiguousOverlaps(mk({ days: [4, 5] }), existing)).toHaveLength(0);
    expect(findAmbiguousOverlaps(mk({ days: [3], priority: 5 }), existing)).toHaveLength(0);
    expect(findAmbiguousOverlaps(mk({ startsOn: "2026-05-01" , days: [3] }), [{ ...existing[0], endsOn: "2026-04-30" }])).toHaveLength(0);
    expect(findAmbiguousOverlaps(mk({ timeFrom: "13:00", timeTo: "14:00" }), [{ ...existing[0], days: null, timeFrom: "09:00", timeTo: "12:00" }])).toHaveLength(0);
  });
  it("domaines et domaines de membre", () => {
    expect(domainInputSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(domainInputSchema.safeParse({ name: "Pompe à chaleur", color: "#3b82f6" }).success).toBe(true);
    expect(domainInputSchema.safeParse({ name: "X", color: "red" }).success).toBe(false);
    expect(memberDomainsInputSchema.safeParse({ userId: id(1), domainIds: [id(2), id(2)] }).success).toBe(false);
    expect(memberDomainsInputSchema.safeParse({ userId: id(1), domainIds: Array.from({ length: 11 }, (_, i) => id(i + 10)) }).success).toBe(false);
  });
  it("libellés lisibles et états", () => {
    expect(describeWindow({ startsOn: null, endsOn: null, days: null, timeFrom: null, timeTo: null })).toBe("en permanence");
    expect(describeWindow({ startsOn: null, endsOn: null, days: [1, 2, 3, 4, 5], timeFrom: "09:00", timeTo: "12:30" })).toBe("lun. au ven., de 9 h à 12 h 30");
    const a = { active: true, startsOn: "2026-04-01", endsOn: null, days: null, timeFrom: null, timeTo: null };
    expect(assignmentStatus(a, NOW)).toBe("upcoming");
    expect(assignmentStatus({ ...a, startsOn: null, endsOn: "2026-03-01" }, NOW)).toBe("expired");
    expect(assignmentStatus({ ...a, startsOn: null, days: [1] }, NOW)).toBe("later");
    expect(assignmentStatus({ ...a, startsOn: null }, NOW)).toBe("live");
    expect(assignmentStatus({ ...a, active: false }, NOW)).toBe("inactive");
  });
});
