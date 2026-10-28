/**
 * Moteur de mise en page des e-mails transactionnels : un contenu structuré (blocs) produit l'HTML (tableaux + styles en ligne,
 * compatible Gmail / Outlook / Apple Mail, mode sombre) ET la version texte. Toute donnée variable est échappée ici, jamais dans les templates.
 */

import { SITE_NAME } from "@/lib/site";

/** Valeurs relevées dans src/styles/tokens.css (thème clair) : l'e-mail doit ressembler à l'application. */
export const BRAND = { name: SITE_NAME, logo: "#2b59ff", ink: "#0f1521", onInk: "#f9fafb", muted: "#6b7280", text: "#374151", line: "#e5e7eb", bg: "#f9fafb", card: "#ffffff", soft: "#f3f4f6" } as const;

export type Block =
  | { t: "h"; text: string }
  | { t: "p"; text: string }
  | { t: "cta"; label: string; url: string }
  | { t: "code"; value: string }
  | { t: "kv"; rows: { k: string; v: string }[] }
  | { t: "note"; text: string; tone?: "info" | "warning" | "danger" | "success" }
  | { t: "list"; items: string[] }
  | { t: "link"; label: string; url: string };

export interface MailContent {
  /** Texte d'aperçu affiché par la boîte de réception à côté de l'objet. */
  preheader: string;
  blocks: Block[];
  /** Ligne de bas de page (pourquoi vous recevez ce message). */
  footnote?: string;
}

export interface RenderedMail { html: string; text: string }

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Seules les adresses http(s) et les liens tel:+chiffres sont acceptés dans un lien (jamais javascript: ni data:). */
export const safeUrl = (u: string): string => (/^(https?:\/\/|tel:\+?\d{6,15}$)/i.test(u) ? u : "#");

/** Couleurs douces de l'application : info-soft / success-soft / warning-soft / destructive-soft. */
const TONES = {
  info: { bg: "#dbeafe", fg: "#1e3a6e", cls: "n-info" },
  success: { bg: "#dbf2dd", fg: "#00573a", cls: "n-success" },
  warning: { bg: "#fdf3dc", fg: "#6b4500", cls: "n-warning" },
  danger: { bg: "#fee2e2", fg: "#8f1d1d", cls: "n-danger" },
} as const;

const FONT = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function blockHtml(b: Block): string {
  switch (b.t) {
    case "h":
      return `<h1 class="ink" style="margin:0 0 16px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:600;color:${BRAND.ink};letter-spacing:-0.02em">${esc(b.text)}</h1>`;
    case "p":
      return `<p class="txt" style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.text}">${esc(b.text).replace(/\n/g, "<br>")}</p>`;
    case "cta":
      // Bouton du site : pilule encre, texte clair, 14px / 600.
      return `<table role="presentation" class="cta" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px"><tr><td align="center" class="btn" bgcolor="${BRAND.ink}" style="border-radius:32px;background:${BRAND.ink}"><a class="btn-a" href="${esc(safeUrl(b.url))}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${BRAND.onInk};text-decoration:none;border-radius:32px">${esc(b.label)}</a></td></tr></table>`;
    case "code":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 24px"><tr><td align="center" class="soft" style="background:${BRAND.soft};border:1px solid ${BRAND.line};border-radius:16px;padding:22px 12px"><span class="ink code" style="font-family:'Geist Mono','SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:10px;color:${BRAND.ink}">${esc(b.value)}</span></td></tr></table>`;
    case "kv":
      return `<table role="presentation" class="line" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:1px solid ${BRAND.line};border-radius:16px;border-collapse:separate;overflow:hidden">${b.rows
        .map(
          (r, i) =>
            `<tr><td class="mut line kcell" style="padding:12px 18px;width:38%;font-family:${FONT};font-size:13px;color:${BRAND.muted};${i ? `border-top:1px solid ${BRAND.line};` : ""}">${esc(r.k)}</td><td class="ink line vcell" style="padding:12px 18px;font-family:${FONT};font-size:14px;font-weight:600;color:${BRAND.ink};${i ? `border-top:1px solid ${BRAND.line};` : ""}">${esc(r.v)}</td></tr>`,
        )
        .join("")}</table>`;
    case "note": {
      const c = TONES[b.tone ?? "info"];
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px"><tr><td class="${c.cls}" style="background:${c.bg};border-radius:12px;padding:14px 18px;font-family:${FONT};font-size:14px;line-height:1.6;color:${c.fg}">${esc(b.text).replace(/\n/g, "<br>")}</td></tr></table>`;
    }
    case "link":
      return `<p class="mut" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.muted}"><a class="mut" href="${esc(safeUrl(b.url))}" target="_blank" style="color:${BRAND.muted};text-decoration:underline">${esc(b.label)}</a></p>`;
    case "list":
      return `<ul class="txt" style="margin:0 0 20px;padding:0 0 0 20px;font-family:${FONT};font-size:15px;line-height:1.7;color:${BRAND.text}">${b.items.map((i) => `<li style="margin:0 0 6px">${esc(i)}</li>`).join("")}</ul>`;
  }
}

function blockText(b: Block): string {
  switch (b.t) {
    case "h":
      return b.text.toUpperCase();
    case "p":
      return b.text;
    case "cta":
      return `${b.label} : ${safeUrl(b.url)}`;
    case "code":
      return `Code : ${b.value}`;
    case "kv":
      return b.rows.map((r) => `${r.k} : ${r.v}`).join("\n");
    case "note":
      return `/!\\ ${b.text}`;
    case "list":
      return b.items.map((i) => `- ${i}`).join("\n");
    case "link":
      return `${b.label} : ${safeUrl(b.url)}`;
  }
}

export function renderMail(c: MailContent, opts: { appUrl: string }): RenderedMail {
  const home = safeUrl(opts.appUrl);
  // Logo Orvolt : version noire (fond clair) et version blanche (mode sombre), hébergées sur le site (adresse absolue obligatoire dans un e-mail).
  const logoBase = home.replace(/\/+$/, "");
  const logoLight = `${logoBase}/brand/orvolt-logo.png`;
  const logoDark = `${logoBase}/brand/orvolt-logo-white.png`;
  const foot = c.footnote ? `<p class="mut" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted}">${esc(c.footnote)}</p>` : "";
  const html = `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(BRAND.name)}</title>
<style>
  /* Mobile : carte pleine largeur, bouton pleine largeur (zone de toucher confortable), code et tableaux resserrés. */
  @media (max-width:620px){
    .outer{padding:16px 8px!important} .wrap{width:100%!important} .pad{padding:26px 20px 12px!important}
    h1{font-size:22px!important} .cta{width:100%!important} .btn{display:block!important} .btn-a{display:block!important;padding:14px 20px!important}
    .code{font-size:28px!important;letter-spacing:6px!important} .kcell{width:40%!important} .kcell,.vcell{padding:10px 14px!important}
  }
  /* Mode sombre = thème .dark de l'application (tokens.css) : fond encre, carte #161c29, bouton clair. */
  @media (prefers-color-scheme:dark){
    .bg{background:#0f1521!important} .card{background:#161c29!important;border-color:rgba(255,255,255,0.125)!important}
    .ink,.ink a{color:#f9fafb!important} .txt{color:#d1d5db!important} .mut{color:#9ca3af!important}
    .line{border-color:rgba(255,255,255,0.125)!important} .soft{background:#1e2535!important;border-color:rgba(255,255,255,0.125)!important}
    .btn{background:#f9fafb!important} .btn-a{color:#0f1521!important}
    .logo-l{display:none!important;max-height:0!important} .logo-d{display:block!important;max-height:none!important}
    .n-info{background:#10233f!important;color:#bfdbfe!important} .n-success{background:#0d2b1d!important;color:#a7e3c3!important}
    .n-warning{background:#33270c!important;color:#f5d98b!important} .n-danger{background:#3a1414!important;color:#fecaca!important}
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${esc(c.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg}"><tr><td align="center" class="outer" style="padding:32px 12px">
  <table role="presentation" class="wrap" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%">
    <tr><td align="center" style="padding:0 4px 20px">
      <a href="${esc(home)}" style="text-decoration:none">
        <img class="logo-l" src="${esc(logoLight)}" alt="${esc(BRAND.name)}" width="104" height="59" border="0" style="display:block;margin:0 auto;width:104px;height:auto;border:0;font-family:${FONT};font-size:20px;font-weight:700;color:${BRAND.ink}">
        <img class="logo-d" src="${esc(logoDark)}" alt="${esc(BRAND.name)}" width="104" height="59" border="0" style="display:none;max-height:0;overflow:hidden;margin:0 auto;width:104px;height:auto;border:0;font-family:${FONT};font-size:20px;font-weight:700;color:#f9fafb">
      </a>
    </td></tr>
    <tr><td class="card pad" style="background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:16px;padding:36px 36px 20px">${c.blocks.map(blockHtml).join("\n")}</td></tr>
    <tr><td style="padding:20px 8px 0" align="center">
      ${foot}
      <p class="mut" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted}">${esc(BRAND.name)} · Le CRM des équipes de terrain · <a class="mut" href="${esc(home)}" style="color:${BRAND.muted}">${esc(home.replace(/^https?:\/\//, ""))}</a></p>
    </td></tr>
  </table>
</td></tr></table>
</body>
</html>`;
  const text = `${c.blocks.map(blockText).join("\n\n")}\n\n--\n${c.footnote ? `${c.footnote}\n` : ""}${BRAND.name} · ${home}\n`;
  return { html, text };
}
