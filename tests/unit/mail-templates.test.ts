import { describe, expect, it } from "vitest";
import { esc, renderMail, safeUrl } from "@/lib/mail/layout";
import { MAIL_SAMPLES, appointmentAssignedMail, landingConfirmationMail, landingNotificationMail, leadAssignedMail, memberAccountMail, verificationCodeMail } from "@/lib/mail/templates";

/** Retire les deux images du logo Orvolt (en-tête de chaque e-mail) : toute autre balise <img serait de l'injection. */
const withoutLogo = (html: string) => html.replace(/<img class="logo-[ld]"[^>]*>/g, "");

describe("e-mails transactionnels", () => {
  it("chaque modèle produit objet, HTML complet et texte, sans balise orpheline", () => {
    for (const s of MAIL_SAMPLES) {
      const m = s.mail();
      expect(m.subject.length, s.id).toBeGreaterThan(5);
      expect(m.subject.length, s.id).toBeLessThanOrEqual(90);
      expect(m.html, s.id).toContain("<!doctype html>");
      expect(m.html.match(/<table/g)?.length, s.id).toBe(m.html.match(/<\/table>/g)?.length);
      expect(m.text, s.id).not.toMatch(/<[a-z]+[ >]/i);
      expect(m.text, s.id).not.toContain("undefined");
      expect(m.html, s.id).not.toContain("undefined");
    }
  });
  it("toute donnée variable est échappée (HTML et attributs)", () => {
    const evil = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;
    const m = leadAssignedMail({ recipientName: evil, leadName: evil, source: evil, phone: evil, city: evil, leadUrl: "https://app.test/leads" });
    expect(m.html).not.toContain("<script>");
    expect(withoutLogo(m.html)).not.toContain("<img");
    expect(m.html).toContain("&lt;script&gt;");
    const a = appointmentAssignedMail({ leadName: evil, startsAt: new Date(), address: evil });
    expect(withoutLogo(a.html)).not.toMatch(/<img|<script/);
    const mm = memberAccountMail({ memberName: evil, orgName: evil, inviterName: evil, roleName: evil, email: evil, resetUrl: "https://app.test/reset?token_hash=x" });
    expect(withoutLogo(mm.html)).not.toMatch(/<img|<script/);
  });
  it("les liens non http(s) sont neutralisés", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,x")).toBe("#");
    expect(safeUrl("https://x.fr/a?b=1&c=2")).toBe("https://x.fr/a?b=1&c=2");
    const r = renderMail({ preheader: "p", blocks: [{ t: "cta", label: "Go", url: "javascript:alert(1)" }] }, { appUrl: "https://x.fr" });
    expect(r.html).not.toContain("javascript:");
  });
  it("le code de vérification figure dans l'objet, l'aperçu et le texte", () => {
    const m = verificationCodeMail({ code: "123456" });
    expect(m.subject).toContain("123456");
    expect(m.html).toContain("123456");
    expect(m.text).toContain("123456");
  });
  it("aucun mot de passe n'est jamais envoyé par e-mail", () => {
    const m = memberAccountMail({ memberName: "A", orgName: "O", inviterName: "B", roleName: "Commercial", email: "a@x.fr", resetUrl: "https://app.test/reset?token_hash=abc&invite=1" });
    expect(m.text.toLowerCase()).toContain("aucun mot de passe");
  });
  it("le mail d'invitation porte le lien à usage unique « Choisir mon mot de passe »", () => {
    const m = memberAccountMail({ memberName: "A", orgName: "O", inviterName: "B", roleName: "Commercial", email: "a@x.fr", resetUrl: "https://app.test/reset?token_hash=abc&invite=1" });
    expect(m.html).toContain("/reset?token_hash=abc");
    expect(m.html).toContain("Choisir mon mot de passe");
    expect(m.text).toContain("Mot de passe oublié");
  });
  it("esc neutralise les 5 caractères sensibles", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

import { isFieldRole, legacyFieldRule } from "@/lib/permissions";
describe("rôle terrain (zones)", () => {
  it("seul le commercial (is_field) se déplace : ni admin, ni prospecteur, ni confirmateur", () => {
    expect(isFieldRole({ is_admin: false, is_field: true, permissions: ["leads.view_own", "leads.edit", "appointments.manage_own"] })).toBe(true);
    expect(isFieldRole({ is_admin: true, is_field: true, permissions: [] })).toBe(false);
    expect(isFieldRole({ is_admin: false, is_field: false, permissions: ["leads.create", "leads.import", "appointments.manage_own"] })).toBe(false);
    expect(isFieldRole({ is_admin: false, is_field: false, permissions: ["appointments.manage_all", "dispatch.manage"] })).toBe(false);
  });
  it("un commercial à qui on accorde leads.create garde sa zone (le drapeau prime sur les permissions)", () => {
    expect(isFieldRole({ is_admin: false, is_field: true, permissions: ["leads.view_own", "leads.create", "appointments.manage_own"] })).toBe(true);
  });
  it("règle historique du backfill : inchangée pour les rôles existants", () => {
    expect(legacyFieldRule(["leads.view_own", "leads.edit", "appointments.manage_own"])).toBe(true);
    expect(legacyFieldRule(["leads.create", "appointments.manage_own"])).toBe(false);
    expect(legacyFieldRule(["appointments.manage_all", "appointments.manage_own"])).toBe(false);
    expect(legacyFieldRule(["leads.view_own"])).toBe(false);
  });
  it("confirmation d'acquisition : n'affirme que ce qui est tenable", () => {
    const rappel = landingConfirmationMail({ firstName: "Marc", kind: "rappel", trialDays: 14 });
    expect(rappel.text).toContain("dans les meilleurs délais");
    expect(rappel.html + rappel.text).not.toMatch(/sans carte|sous \d|dans l'heure|24 ?h/i);
    const essai = landingConfirmationMail({ firstName: "Marc", kind: "essai", trialDays: 14 });
    expect(essai.subject).toContain("14 jours");
    expect(essai.html).toContain("/signup");
  });
  it("alerte interne : téléphone cliquable (tel:) et tout est échappé", () => {
    const evil = `<img src=x onerror=alert(1)>"`;
    const m = landingNotificationMail({ kind: "rappel", name: evil, phone: "+33612345678", phoneDisplay: "06 12 34 56 78", email: evil, company: evil, slot: evil, trade: evil, campaign: evil, landingPath: evil });
    expect(m.html).toContain('href="tel:+33612345678"');
    expect(withoutLogo(m.html)).not.toMatch(/<img|<script/);
    expect(m.html).toContain("&lt;img");
    expect(m.text).toContain("tel:+33612345678");
    expect(safeUrl("tel:+33612345678")).toBe("tel:+33612345678");
    expect(safeUrl("tel:javascript")).toBe("#");
  });
});
