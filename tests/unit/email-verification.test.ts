import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const K = "k".repeat(32);
const { hashCode, signProof, verifyProof } = await import("@/lib/email-verification");
const { sendMail } = await import("@/lib/mailer");

describe("code de vérification e-mail", () => {
  it("l'empreinte dépend de l'adresse et du code (un code ne sert qu'à son adresse)", () => {
    const h = hashCode("a@x.fr", "123456", K);
    expect(h).toHaveLength(64);
    expect(hashCode(" A@X.fr ", "123456", K)).toBe(h);
    expect(hashCode("b@x.fr", "123456", K)).not.toBe(h);
    expect(hashCode("a@x.fr", "123457", K)).not.toBe(h);
  });
  it("la preuve signée est liée à l'adresse, expire et ne se falsifie pas", () => {
    const now = 1_800_000_000_000;
    const t = signProof("Ada@Example.com", now, K);
    expect(verifyProof(t, "ada@example.com", now + 1000, K)).toBe(true);
    expect(verifyProof(t, "autre@example.com", now + 1000, K)).toBe(false);
    expect(verifyProof(t, "ada@example.com", now + 31 * 60_000, K)).toBe(false);
    expect(verifyProof(t.replace(/.$/, "0"), "ada@example.com", now + 1000, K)).toBe(false);
    expect(verifyProof(undefined, "ada@example.com", now, K)).toBe(false);
    expect(verifyProof(t, "ada@example.com", now + 1000, "z".repeat(32))).toBe(false);
  });
});

describe("envoi d'e-mail (Brevo)", () => {
  const mail = { to: "a@x.fr", subject: "Code", text: "123456" };
  it("sans clé : simulé en développement, refusé en production", async () => {
    expect(await sendMail(mail, { NODE_ENV: "development", ALLOW_DEV_CODE: "1" })).toEqual({ ok: true, dev: true });
    expect(await sendMail(mail, { NODE_ENV: "production", ALLOW_DEV_CODE: "1" })).toEqual({ ok: false });
  });
  it("le code de dev exige ALLOW_DEV_CODE=1, hors production et hors Vercel (preview comprise)", async () => {
    expect(await sendMail(mail, { NODE_ENV: "development" })).toEqual({ ok: true, dev: false });
    expect(await sendMail(mail, { NODE_ENV: "development", ALLOW_DEV_CODE: "1", VERCEL_ENV: "preview" })).toEqual({ ok: true, dev: false });
    expect(await sendMail(mail, { NODE_ENV: "development", ALLOW_DEV_CODE: "1", VERCEL: "1" })).toEqual({ ok: true, dev: false });
  });
  it("avec clé : appelle l'API Brevo avec expéditeur et destinataire", async () => {
    const f = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    expect(await sendMail(mail, { BREVO_API_KEY: "key", BREVO_SENDER_EMAIL: "noreply@mycrm.test", NODE_ENV: "production" }, f)).toEqual({ ok: true, dev: false });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("key");
    expect(JSON.parse(init.body)).toMatchObject({ sender: { email: "noreply@mycrm.test" }, to: [{ email: "a@x.fr" }] });
  });
  it("clé sans expéditeur, ou API en erreur : échec (jamais de succès simulé)", async () => {
    expect(await sendMail(mail, { BREVO_API_KEY: "key" })).toEqual({ ok: false });
    expect(await sendMail(mail, { BREVO_API_KEY: "key", BREVO_SENDER_EMAIL: "n@x.fr" }, (async () => ({ ok: false })) as unknown as typeof fetch)).toEqual({ ok: false });
  });
});
