import { describe, expect, it } from "vitest";
import { createMemberSchema, loginSchema, roleSchema, signupSchema } from "@/lib/validation/auth";

const valid = { fullName: "Ada Lovelace", email: " ADA@Example.com ", password: "motdepasse1", orgName: "Solaire SARL", template: "energie" };

describe("signupSchema", () => {
  it("accepte une saisie valide et normalise l'e-mail", () => {
    const r = signupSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("ada@example.com");
  });
  it("refuse e-mail invalide, mot de passe court, template inconnu", () => {
    expect(signupSchema.safeParse({ ...valid, email: "pas-un-mail" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, password: "court" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, template: "inconnu" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, orgName: "A" }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("exige un mot de passe", () => {
    expect(loginSchema.safeParse({ email: "a@b.fr", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.fr", password: "x" }).success).toBe(true);
  });
});

describe("createMemberSchema / roleSchema", () => {
  it("valide le rôle en uuid", () => {
    const base = { fullName: "Jean Dupont", email: "j@d.fr", password: "motdepasse1" };
    expect(createMemberSchema.safeParse({ ...base, roleId: "nope" }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, roleId: crypto.randomUUID() }).success).toBe(true);
  });
  it("refuse une permission inconnue", () => {
    expect(roleSchema.safeParse({ name: "Support", permissions: ["leads.view_all"] }).success).toBe(true);
    expect(roleSchema.safeParse({ name: "Support", permissions: ["root"] }).success).toBe(false);
  });
});
