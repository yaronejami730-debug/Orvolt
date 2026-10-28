import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MAIL_SAMPLES } from "@/lib/mail/templates";

export const metadata: Metadata = { title: "Aperçu des e-mails", robots: { index: false, follow: false } };

/** Aperçu du mode sombre : les règles prefers-color-scheme:dark sont appliquées d'office. */
const dark = (html: string) => html.replace("@media (prefers-color-scheme:dark){", "@media all{");
const font = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Galerie de tous les e-mails transactionnels (développement uniquement). Styles en ligne : indépendante du thème de l'application. */
export default function MailPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const mails = MAIL_SAMPLES.map((m) => ({ id: m.id, label: m.label, ...m.mail() }));
  return (
    <main style={{ fontFamily: font, maxWidth: 1180, margin: "0 auto", padding: "32px 16px", color: "#0f1521" }}>
      <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>Aperçu des e-mails</h1>
      <p style={{ color: "#6b7280", fontSize: 14 }}>{mails.length} modèles : ordinateur, mobile (375 px) et mobile en mode sombre. La version texte est sous chaque aperçu.</p>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0 32px" }}>
        {mails.map((m) => <a key={m.id} href={`#${m.id}`} style={{ border: "1px solid #e5e7eb", borderRadius: 32, padding: "4px 12px", fontSize: 13, color: "#0f1521", textDecoration: "none" }}>{m.label}</a>)}
      </nav>
      {mails.map((m) => (
        <section key={m.id} id={m.id} data-testid={`mail-${m.id}`} style={{ marginBottom: 56 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>{m.label}</h2>
          <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 12px" }}>Objet : <strong style={{ color: "#0f1521" }}>{m.subject}</strong></p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
            <iframe title={`${m.label} (ordinateur)`} srcDoc={m.html} sandbox="" style={{ flex: "1 1 560px", minWidth: 0, height: 640, border: "1px solid #e5e7eb", borderRadius: 12, background: "#f9fafb" }} />
            <iframe title={`${m.label} (mobile)`} srcDoc={m.html} sandbox="" style={{ width: 375, height: 640, border: "1px solid #e5e7eb", borderRadius: 24, background: "#f9fafb" }} />
            <iframe title={`${m.label} (mobile, sombre)`} srcDoc={dark(m.html)} sandbox="" style={{ width: 375, height: 640, border: "1px solid #e5e7eb", borderRadius: 24, background: "#0f1521" }} />
          </div>
          <details style={{ fontSize: 14, marginTop: 8 }}><summary style={{ cursor: "pointer", color: "#6b7280" }}>Version texte</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, background: "#fff" }}>{m.text}</pre></details>
        </section>
      ))}
    </main>
  );
}
