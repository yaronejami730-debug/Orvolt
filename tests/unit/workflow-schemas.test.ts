import { describe, expect, it } from "vitest";
import {
  actionInputSchema, createStatusSchema, fieldInputSchema, isForbiddenHost, saveTransitionsSchema, slugifyKey, sourceInputSchema, webhookUrlSchema,
} from "@/lib/validation/workflow";

const uuid = () => crypto.randomUUID();

describe("actions automatiques", () => {
  it("assign exige l'utilisateur ou le rôle selon le mode", () => {
    expect(actionInputSchema.safeParse({ type: "assign", enabled: true, config: { mode: "role", roleId: uuid() } }).success).toBe(true);
    expect(actionInputSchema.safeParse({ type: "assign", enabled: true, config: { mode: "user" } }).success).toBe(false);
  });
  it("notify exige un message et le destinataire", () => {
    expect(actionInputSchema.safeParse({ type: "notify", enabled: true, config: { recipient: "assignee", message: "Salut" } }).success).toBe(true);
    expect(actionInputSchema.safeParse({ type: "notify", enabled: true, config: { recipient: "assignee", message: "" } }).success).toBe(false);
    expect(actionInputSchema.safeParse({ type: "notify", enabled: true, config: { recipient: "role", message: "x" } }).success).toBe(false);
  });
  it("create_task borne le délai", () => {
    const ok = { title: "Rappeler", delay: 2, unit: "days", assignee: "assignee" };
    expect(actionInputSchema.safeParse({ type: "create_task", enabled: true, config: ok }).success).toBe(true);
    expect(actionInputSchema.safeParse({ type: "create_task", enabled: true, config: { ...ok, delay: 9999 } }).success).toBe(false);
    expect(actionInputSchema.safeParse({ type: "create_task", enabled: true, config: { ...ok, unit: "weeks" } }).success).toBe(false);
  });
  it("webhook : https public uniquement", () => {
    expect(webhookUrlSchema.safeParse("https://hooks.example.com/x").success).toBe(true);
    for (const bad of ["http://example.com", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.1", "https://169.254.169.254/", "ftp://a.b", "pas une url", "https://user:pw@example.com"]) {
      expect(webhookUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(isForbiddenHost("172.20.0.1")).toBe(true);
    expect(isForbiddenHost("172.32.0.1")).toBe(false);
  });
  it("type d'action inconnu refusé", () => {
    expect(actionInputSchema.safeParse({ type: "sms", enabled: true, config: {} }).success).toBe(false);
  });
});

describe("statuts, champs, sources", () => {
  it("statut : couleur de la palette et type valides", () => {
    expect(createStatusSchema.safeParse({ name: "Chaud", color: "#ef4444", kind: "normal" }).success).toBe(true);
    expect(createStatusSchema.safeParse({ name: "Chaud", color: "#123456", kind: "normal" }).success).toBe(false);
    expect(createStatusSchema.safeParse({ name: "", color: "#ef4444", kind: "normal" }).success).toBe(false);
    expect(createStatusSchema.safeParse({ name: "X", color: "#ef4444", kind: "autre" }).success).toBe(false);
  });
  it("transitions : rôles 'all' ou liste non vide d'uuid", () => {
    expect(saveTransitionsSchema.safeParse({ fromId: uuid(), targets: [{ toId: uuid(), roles: "all" }] }).success).toBe(true);
    expect(saveTransitionsSchema.safeParse({ fromId: uuid(), targets: [{ toId: uuid(), roles: [] }] }).success).toBe(false);
  });
  it("champ liste : 2 options minimum, sans doublon", () => {
    const base = { label: "Type", type: "select", required: false, visibleRoles: null, editableRoles: null };
    expect(fieldInputSchema.safeParse({ ...base, choices: ["A", "B"] }).success).toBe(true);
    expect(fieldInputSchema.safeParse({ ...base, choices: ["A"] }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, choices: ["A", "a"] }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, type: "text" }).success).toBe(true);
  });
  it("source : nom requis", () => {
    expect(sourceInputSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ name: "Salon" }).success).toBe(true);
  });
  it("slugifyKey produit une clé valide", () => {
    expect(slugifyKey("Facture d'énergie (€)")).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
    expect(slugifyKey("123 test")).toMatch(/^[a-z]/);
  });
});
