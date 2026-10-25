import { describe, expect, it, vi } from "vitest";
import { runActions, type AutomationStore, type Deps, type LeadSnapshot, type RunContext, type StoredAction } from "@/lib/automation/engine";
import { pickRoundRobin } from "@/lib/automation/round-robin";
import { orgWebhookSecret, signPayload, signatureHeader, verifySignature } from "@/lib/automation/signature";
import { UnsafeUrlError } from "@/lib/net/safe-fetch";

const ORG = crypto.randomUUID();
const LEAD = crypto.randomUUID();
const ROLE = crypto.randomUUID();
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";

function memStore(over: Partial<LeadSnapshot> = {}, recentWebhooks = 1) {
  const lead: LeadSnapshot = { id: LEAD, org_id: ORG, status_id: "s2", assigned_to: null, first_name: "Ada", last_name: "Lovelace", email: "a@b.fr", phone: null, value: 100, ...over };
  const runs = new Map<string, { result?: string; error?: string | null; attempts?: number }>();
  const notifications: { userId: string; dedupeKey: string; payload: Record<string, unknown> }[] = [];
  const tasks: { assignedTo: string | null; title: string; dueAt: string; dedupeKey: string }[] = [];
  const members: Record<string, string[]> = { all: [U1, U2, U3], [ROLE]: [U1, U2, U3] };
  const assignedHistory: Record<string, string | null> = { [U1]: "2026-01-02T00:00:00Z", [U2]: null, [U3]: "2026-01-01T00:00:00Z" };
  const store: AutomationStore = {
    claim: async (key) => (runs.has(key) ? false : (runs.set(key, {}), true)),
    finish: async (key, result, error, attempts) => void runs.set(key, { result, error, attempts }),
    getLead: async () => lead,
    statusName: async (id) => `Statut ${id}`,
    activeMembers: async (_o, role) => (role ? members[role] ?? [] : members.all!),
    lastAssigned: async () => assignedHistory,
    setAssignee: async (_o, _l, u) => void (lead.assigned_to = u),
    addNotification: async (n) => {
      if (!notifications.some((x) => x.dedupeKey === n.dedupeKey)) notifications.push(n);
    },
    secretVersion: async () => 1,
    webhookRunsSince: async () => recentWebhooks,
    addTask: async (t) => {
      if (!tasks.some((x) => x.dedupeKey === t.dedupeKey)) tasks.push(t);
    },
  };
  return { store, lead, runs, notifications, tasks };
}

const ctx: RunContext = { orgId: ORG, orgSlug: "acme", leadId: LEAD, fromStatusId: "s1", toStatusId: "s2", eventId: "ev1", actorId: U3 };
const NOW = new Date("2026-03-01T10:00:00Z");
function deps(store: AutomationStore, fetchImpl?: Deps["fetch"]): Deps {
  return {
    store,
    fetch: fetchImpl ?? (async () => ({ status: 200 })),
    secret: (org) => orgWebhookSecret("salt", org),
    now: () => NOW,
    sleep: async () => undefined,
    log: () => undefined,
  };
}
const act = (id: string, type: string, config: unknown, position = 0): StoredAction => ({ id, type, config, position });

describe("round-robin", () => {
  it("choisit le moins récemment assigné, jamais assigné d'abord", () => {
    expect(pickRoundRobin([U1, U2, U3], { [U1]: "2026-01-02T00:00:00Z", [U2]: null, [U3]: "2026-01-01T00:00:00Z" })).toBe(U2);
    expect(pickRoundRobin([U1, U3], { [U1]: "2026-01-02T00:00:00Z", [U3]: "2026-01-01T00:00:00Z" })).toBe(U3);
  });
  it("départage par id et gère le vide", () => {
    expect(pickRoundRobin([U3, U1], {})).toBe(U1);
    expect(pickRoundRobin([], {})).toBeNull();
  });
});

describe("signature HMAC", () => {
  it("signe et vérifie ; rejette altération, mauvais secret, horodatage périmé", () => {
    const secret = orgWebhookSecret("salt", ORG);
    const body = '{"a":1}';
    const header = signatureHeader(secret, 1000, body);
    expect(header).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
    expect(verifySignature(secret, header, body, 300, 1100)).toBe(true);
    expect(verifySignature(secret, header, body + " ", 300, 1100)).toBe(false);
    expect(verifySignature("autre", header, body, 300, 1100)).toBe(false);
    expect(verifySignature(secret, header, body, 300, 5000)).toBe(false);
    expect(verifySignature(secret, "n'importe quoi", body)).toBe(false);
  });
  it("secrets distincts par org, signature déterministe", () => {
    expect(orgWebhookSecret("salt", ORG)).not.toBe(orgWebhookSecret("salt", crypto.randomUUID()));
    expect(signPayload("k", 1, "b")).toBe(signPayload("k", 1, "b"));
  });
});

describe("moteur d'actions", () => {
  it("quota d'egress : au-delà de 30 webhooks/min, échec « Quota » sans appel réseau", async () => {
    const m = memStore({}, 31);
    const f = vi.fn();
    const r = await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" })], deps(m.store, f));
    expect(r[0]).toMatchObject({ result: "failed" });
    expect(r[0]!.error).toMatch(/Quota/);
    expect(f).not.toHaveBeenCalled();
    expect(m.runs.get("ev1:w1")).toMatchObject({ result: "failed" });
    const ok = memStore({}, 30);
    const f2 = vi.fn().mockResolvedValue({ status: 200 });
    expect((await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" })], deps(ok.store, f2)))[0]!.result).toBe("success");
  });
  it("secret versionné : une nouvelle version change la signature", async () => {
    expect(orgWebhookSecret("salt", ORG, 2)).not.toBe(orgWebhookSecret("salt", ORG, 1));
    expect(orgWebhookSecret("salt", ORG, 1)).toBe(orgWebhookSecret("salt", ORG));
  });
  it("sel de signature : absent, faible ou valeur de développement refusés", async () => {
    const { requireSigningSalt } = await import("@/lib/automation/signature");
    expect(() => requireSigningSalt({})).toThrow();
    expect(() => requireSigningSalt({ WEBHOOK_SIGNING_SALT: "dev-insecure-salt" })).toThrow();
    expect(() => requireSigningSalt({ WEBHOOK_SIGNING_SALT: "court" })).toThrow();
    expect(requireSigningSalt({ WEBHOOK_SIGNING_SALT: "a".repeat(32) })).toHaveLength(32);
  });
  it("assign (rôle) : round-robin sur les membres actifs", async () => {
    const m = memStore();
    const r = await runActions(ctx, [act("a1", "assign", { mode: "role", roleId: ROLE })], deps(m.store));
    expect(r[0]!.result).toBe("success");
    expect(m.lead.assigned_to).toBe(U2);
  });
  it("assign (utilisateur) : refuse un non-membre (skipped)", async () => {
    const m = memStore();
    const r = await runActions(ctx, [act("a1", "assign", { mode: "user", userId: crypto.randomUUID() })], deps(m.store));
    expect(r[0]!.result).toBe("skipped");
    expect(m.lead.assigned_to).toBeNull();
  });
  it("notify : assigné, rôle, utilisateur ; sans destinataire = skipped", async () => {
    const m = memStore({ assigned_to: U1 });
    await runActions(ctx, [act("n1", "notify", { recipient: "assignee", message: "Hop" }), act("n2", "notify", { recipient: "role", roleId: ROLE, message: "Tous" }, 1)], deps(m.store));
    expect(m.notifications.map((n) => n.userId).sort()).toEqual([U1, U1, U2, U3].sort());
    const none = memStore();
    const r = await runActions(ctx, [act("n1", "notify", { recipient: "assignee", message: "x" })], deps(none.store));
    expect(r[0]!.result).toBe("skipped");
  });
  it("create_task : échéance calculée (jours / heures), assigné = assigné du lead sinon l'acteur", async () => {
    const m = memStore();
    await runActions(ctx, [act("t1", "create_task", { title: "Rappeler", delay: 2, unit: "days", assignee: "assignee" }), act("t2", "create_task", { title: "Vite", delay: 4, unit: "hours", assignee: "assignee" }, 1)], deps(m.store));
    expect(m.tasks[0]).toMatchObject({ title: "Rappeler", assignedTo: U3, dueAt: "2026-03-03T10:00:00.000Z" });
    expect(m.tasks[1]!.dueAt).toBe("2026-03-01T14:00:00.000Z");
    const m2 = memStore({ assigned_to: U1 });
    await runActions(ctx, [act("t1", "create_task", { title: "x", delay: 0, unit: "days", assignee: "assignee" })], deps(m2.store));
    expect(m2.tasks[0]!.assignedTo).toBe(U1);
  });
  it("webhook : POST signé, payload versionné, via le fetch sécurisé", async () => {
    const m = memStore();
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const f = vi.fn(async (url: string, o: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: o.headers, body: o.body });
      return { status: 200 };
    });
    const r = await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" })], deps(m.store, f));
    expect(r[0]!.result).toBe("success");
    const c = calls[0]!;
    const payload = JSON.parse(c.body);
    expect(payload).toMatchObject({ version: 1, event: "lead.status_changed", id: "ev1:w1", org: { id: ORG }, lead: { id: LEAD }, to_status: { id: "s2" } });
    expect(verifySignature(orgWebhookSecret("salt", ORG), c.headers["x-leadforge-signature"]!, c.body, 300, Math.floor(NOW.getTime() / 1000))).toBe(true);
  });
  it("webhook : réessaie sur 5xx puis réussit ; 4xx = pas de retry ; UnsafeUrlError = pas de retry", async () => {
    const m = memStore();
    const f = vi.fn().mockResolvedValueOnce({ status: 503 }).mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce({ status: 204 });
    const r = await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" })], deps(m.store, f));
    expect(r[0]!.result).toBe("success");
    expect(f).toHaveBeenCalledTimes(3);
    expect(m.runs.get("ev1:w1")!.attempts).toBe(3);

    const m2 = memStore();
    const f2 = vi.fn().mockResolvedValue({ status: 404 });
    const r2 = await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" })], deps(m2.store, f2));
    expect(r2[0]).toMatchObject({ result: "failed" });
    expect(f2).toHaveBeenCalledTimes(1);

    const m3 = memStore();
    const f3 = vi.fn().mockRejectedValue(new UnsafeUrlError("Adresse non autorisée."));
    const r3 = await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" })], deps(m3.store, f3));
    expect(r3[0]!.result).toBe("failed");
    expect(f3).toHaveBeenCalledTimes(1);
  });
  it("webhook : épuise les 3 tentatives sur 500 puis échoue", async () => {
    const m = memStore();
    const f = vi.fn().mockResolvedValue({ status: 500 });
    const r = await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" })], deps(m.store, f));
    expect(r[0]!.result).toBe("failed");
    expect(f).toHaveBeenCalledTimes(3);
    expect(m.runs.get("ev1:w1")).toMatchObject({ result: "failed" });
  });
  it("config stockée invalide ou URL interne : échec journalisé, jamais d'appel réseau", async () => {
    const m = memStore();
    const f = vi.fn();
    const r = await runActions(ctx, [act("w1", "webhook", { url: "http://169.254.169.254/" }), act("w2", "webhook", { url: "https://localhost/x" }, 1), act("x1", "ssh", {}, 2)], deps(m.store, f));
    expect(r.map((x) => x.result)).toEqual(["failed", "failed", "failed"]);
    expect(f).not.toHaveBeenCalled();
  });
  it("un échec n'empêche pas les actions suivantes", async () => {
    const m = memStore();
    const f = vi.fn().mockRejectedValue(new Error("boom"));
    const r = await runActions(ctx, [act("w1", "webhook", { url: "https://hooks.example.com/x" }, 0), act("t1", "create_task", { title: "Après", delay: 1, unit: "days", assignee: "assignee" }, 1)], { ...deps(m.store, f), sleep: async () => undefined });
    expect(r.map((x) => x.result)).toEqual(["failed", "success"]);
    expect(m.tasks).toHaveLength(1);
  });
  it("idempotence : rejouer le même événement n'exécute rien de plus", async () => {
    const m = memStore({ assigned_to: U1 });
    const actions = [act("n1", "notify", { recipient: "assignee", message: "Hop" }), act("t1", "create_task", { title: "T", delay: 1, unit: "days", assignee: "assignee" }, 1)];
    await runActions(ctx, actions, deps(m.store));
    const again = await runActions(ctx, actions, deps(m.store));
    expect(again.map((x) => x.result)).toEqual(["duplicate", "duplicate"]);
    expect(m.notifications).toHaveLength(1);
    expect(m.tasks).toHaveLength(1);
    // un nouvel événement exécute à nouveau
    await runActions({ ...ctx, eventId: "ev2" }, actions, deps(m.store));
    expect(m.tasks).toHaveLength(2);
  });
  it("exécute dans l'ordre des positions", async () => {
    const m = memStore();
    await runActions(ctx, [act("b", "create_task", { title: "Second", delay: 1, unit: "days", assignee: "assignee" }, 5), act("a", "create_task", { title: "Premier", delay: 1, unit: "days", assignee: "assignee" }, 1)], deps(m.store));
    expect(m.tasks.map((t) => t.title)).toEqual(["Premier", "Second"]);
  });
});
