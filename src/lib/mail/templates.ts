import { SITE_NAME, siteUrl } from "@/lib/site";
import { BRAND, renderMail, type Block, type MailContent } from "./layout";

/** Un message prêt à envoyer (sans destinataire). */
export interface MailBody { subject: string; text: string; html: string }

const TZ = "Europe/Paris";
export const dateFr = (iso: string | Date) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: TZ }).format(new Date(iso));
export const dateTimeFr = (iso: string | Date) => {
  const d = new Date(iso);
  return `${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d)} à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d).replace(":", "h")}`;
};
const link = (path: string) => `${siteUrl()}${path}`;
const hello = (name?: string | null) => (name?.trim() ? `Bonjour ${name.trim()},` : "Bonjour,");

function build(subject: string, c: MailContent): MailBody {
  return { subject, ...renderMail(c, { appUrl: siteUrl() }) };
}
const sign: Block = { t: "p", text: `À très vite,\nL'équipe ${BRAND.name}` };

/* ───────────── Compte et accès ───────────── */

export function verificationCodeMail(d: { code: string }): MailBody {
  return build(`${d.code} est votre code de vérification ${BRAND.name}`, {
    preheader: `Votre code : ${d.code}. Il est valable 10 minutes.`,
    blocks: [
      { t: "h", text: "Vérifiez votre adresse e-mail" },
      { t: "p", text: "Saisissez ce code à 6 chiffres pour finaliser la création de votre espace :" },
      { t: "code", value: d.code },
      { t: "note", text: `Ce code est valable 10 minutes et ne sert qu'une fois. Ne le communiquez à personne : l'équipe ${SITE_NAME} ne vous le demandera jamais.`, tone: "warning" },
    ],
    footnote: "Vous n'avez pas demandé ce code ? Ignorez simplement ce message, aucun compte ne sera créé.",
  });
}

export function welcomeMail(d: { firstName?: string | null; orgName: string; trialDays: number }): MailBody {
  return build(`Bienvenue sur ${BRAND.name}, votre espace est prêt`, {
    preheader: `${d.orgName} est créé : ${d.trialDays} jours d'essai pour tout tester.`,
    blocks: [
      { t: "h", text: `Bienvenue sur ${SITE_NAME}` },
      { t: "p", text: `${hello(d.firstName)}\n\nL'espace « ${d.orgName} » est prêt. Vous disposez de ${d.trialDays} jours d'essai gratuit, sans engagement.` },
      { t: "list", items: ["Personnalisez vos statuts et vos champs", "Importez vos leads (CSV) ou branchez Meta, Google, un webhook", "Invitez votre équipe et attribuez les rôles", "Planifiez vos rendez-vous avec la zone d'intervention"] },
      { t: "cta", label: "Ouvrir mon espace", url: link("/dashboard") },
      sign,
    ],
    footnote: `Vous recevez ce message car un espace ${BRAND.name} vient d'être créé avec cette adresse.`,
  });
}

export function memberAccountMail(d: { memberName?: string | null; orgName: string; inviterName: string; roleName: string; email: string; resetUrl: string }): MailBody {
  return build(`${d.inviterName} vous a ajouté à ${d.orgName} sur ${BRAND.name}`, {
    preheader: `Votre compte ${d.orgName} est créé avec le rôle ${d.roleName}.`,
    blocks: [
      { t: "h", text: `Vous rejoignez ${d.orgName}` },
      { t: "p", text: `${hello(d.memberName)}\n\n${d.inviterName} vient de créer votre accès à l'espace « ${d.orgName} ».` },
      { t: "kv", rows: [{ k: "Identifiant", v: d.email }, { k: "Votre rôle", v: d.roleName }, { k: "Mot de passe", v: "À choisir par vous-même" }] },
      { t: "cta", label: "Choisir mon mot de passe", url: d.resetUrl },
      { t: "note", text: "Ce lien est personnel et à usage unique. S'il a expiré, utilisez « Mot de passe oublié » avec cette adresse e-mail. Aucun mot de passe n'est envoyé par e-mail ni connu de votre administrateur.", tone: "info" },
    ],
    footnote: "Vous ne connaissez pas cette organisation ? Ignorez ce message ou prévenez l'administrateur.",
  });
}

export function passwordResetMail(d: { firstName?: string | null; resetUrl: string }): MailBody {
  return build("Réinitialisez votre mot de passe", {
    preheader: "Ce lien est valable 1 heure.",
    blocks: [
      { t: "h", text: "Un nouveau mot de passe" },
      { t: "p", text: `${hello(d.firstName)}\n\nVous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.` },
      { t: "cta", label: "Choisir un mot de passe", url: d.resetUrl },
      { t: "note", text: "Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste inchangé.", tone: "warning" },
    ],
  });
}

export function partnerInviteMail(d: { parentOrgName: string; partnerOrgName: string; inviterName: string; resetUrl: string }): MailBody {
  return build(`${d.parentOrgName} vous ouvre un espace régie`, {
    preheader: `${d.partnerOrgName} : prospectez et confirmez des rendez-vous pour ${d.parentOrgName}.`,
    blocks: [
      { t: "h", text: "Un espace pour votre régie" },
      { t: "p", text: `${d.inviterName} (${d.parentOrgName}) a créé l'espace « ${d.partnerOrgName} » pour que vous puissiez prospecter et générer des rendez-vous. ${d.parentOrgName} suit l'avancement de chaque lead en temps réel.` },
      { t: "cta", label: "Choisir mon mot de passe", url: d.resetUrl },
      { t: "note", text: "Ce lien est personnel et à usage unique. S'il a expiré, utilisez « Mot de passe oublié » avec cette adresse e-mail.", tone: "info" },
    ],
    footnote: "L'abonnement et les places de votre espace sont gérés par l'organisation qui vous a invité.",
  });
}

/* ───────────── Rendez-vous et leads ───────────── */

export interface AppointmentMailData {
  recipientName?: string | null;
  leadName: string;
  startsAt: string | Date;
  address?: string | null;
  phone?: string | null;
  agentName?: string | null;
  appointmentUrl?: string;
}

export function appointmentAssignedMail(d: AppointmentMailData): MailBody {
  return build(`Nouveau rendez-vous : ${d.leadName}, ${dateTimeFr(d.startsAt)}`, {
    preheader: `${dateTimeFr(d.startsAt)}${d.address ? ` · ${d.address}` : ""}`,
    blocks: [
      { t: "h", text: "Un rendez-vous vous est attribué" },
      { t: "p", text: `${hello(d.recipientName)}\n\nUn nouveau rendez-vous vient d'être ajouté à votre agenda.` },
      { t: "kv", rows: apptRows(d) },
      { t: "cta", label: "Voir le rendez-vous", url: d.appointmentUrl ?? link("/agenda") },
    ],
    footnote: "Vous recevez ce message car le rendez-vous a été attribué à votre compte.",
  });
}

export function appointmentReminderMail(d: AppointmentMailData & { when: "day" | "hour" }): MailBody {
  const lead = d.when === "day" ? "Demain" : "Dans une heure";
  return build(`${lead} : rendez-vous avec ${d.leadName}`, {
    preheader: `${dateTimeFr(d.startsAt)}${d.address ? ` · ${d.address}` : ""}`,
    blocks: [
      { t: "h", text: `${lead}, rendez-vous avec ${d.leadName}` },
      { t: "p", text: `${hello(d.recipientName)}\n\nPetit rappel : vous avez un rendez-vous ${d.when === "day" ? "demain" : "très bientôt"}.` },
      { t: "kv", rows: apptRows(d) },
      { t: "cta", label: "Ouvrir la fiche du lead", url: d.appointmentUrl ?? link("/agenda") },
    ],
    footnote: "Vous recevez ce rappel car vous êtes assigné à ce rendez-vous.",
  });
}

/** Rappel envoyé au client final (le lead) : ton sobre, sans lien vers l'application. */
export function appointmentCustomerReminderMail(d: { customerName?: string | null; companyName: string; startsAt: string | Date; address?: string | null; agentName?: string | null; contactPhone?: string | null }): MailBody {
  return build(`Rappel de votre rendez-vous, ${dateTimeFr(d.startsAt)}`, {
    preheader: `${d.companyName} vous attend ${dateTimeFr(d.startsAt)}.`,
    blocks: [
      { t: "h", text: "Votre rendez-vous approche" },
      { t: "p", text: `${hello(d.customerName)}\n\nNous vous rappelons votre rendez-vous avec ${d.companyName}.` },
      { t: "kv", rows: [{ k: "Date", v: dateTimeFr(d.startsAt) }, ...(d.address ? [{ k: "Adresse", v: d.address }] : []), ...(d.agentName ? [{ k: "Votre interlocuteur", v: d.agentName }] : []), ...(d.contactPhone ? [{ k: "Besoin de décaler ?", v: d.contactPhone }] : [])] },
      { t: "p", text: "Merci de prévenir au plus tôt en cas d'empêchement." },
    ],
    footnote: `Message envoyé au nom de ${d.companyName}.`,
  });
}

export function appointmentCancelledMail(d: AppointmentMailData): MailBody {
  return build(`Rendez-vous annulé : ${d.leadName}`, {
    preheader: `Le rendez-vous du ${dateTimeFr(d.startsAt)} a été annulé.`,
    blocks: [
      { t: "h", text: "Un rendez-vous est annulé" },
      { t: "p", text: `${hello(d.recipientName)}\n\nLe rendez-vous suivant a été annulé et retiré de votre agenda :` },
      { t: "kv", rows: apptRows(d) },
      { t: "cta", label: "Ouvrir mon agenda", url: link("/agenda") },
    ],
  });
}

export function leadAssignedMail(d: { recipientName?: string | null; leadName: string; source?: string | null; phone?: string | null; city?: string | null; leadUrl: string }): MailBody {
  return build(`Nouveau lead pour vous : ${d.leadName}`, {
    preheader: `${d.leadName}${d.city ? ` · ${d.city}` : ""}${d.source ? ` · ${d.source}` : ""}`,
    blocks: [
      { t: "h", text: "Un nouveau lead vous est attribué" },
      { t: "p", text: `${hello(d.recipientName)}\n\nContactez-le rapidement : un premier appel dans l'heure multiplie les chances de rendez-vous.` },
      { t: "kv", rows: [{ k: "Lead", v: d.leadName }, ...(d.phone ? [{ k: "Téléphone", v: d.phone }] : []), ...(d.city ? [{ k: "Ville", v: d.city }] : []), ...(d.source ? [{ k: "Source", v: d.source }] : [])] },
      { t: "cta", label: "Ouvrir la fiche", url: d.leadUrl },
    ],
    footnote: "Vous recevez ce message car le lead a été attribué à votre compte.",
  });
}

export function taskReminderMail(d: { recipientName?: string | null; title: string; dueAt: string | Date; leadName?: string | null; taskUrl?: string }): MailBody {
  return build(`Tâche à faire : ${d.title}`, {
    preheader: `Échéance ${dateTimeFr(d.dueAt)}`,
    blocks: [
      { t: "h", text: "Une tâche arrive à échéance" },
      { t: "p", text: `${hello(d.recipientName)}\n\n« ${d.title} »${d.leadName ? ` (lead : ${d.leadName})` : ""} est à faire pour ${dateTimeFr(d.dueAt)}.` },
      { t: "cta", label: "Voir mes tâches", url: d.taskUrl ?? link("/tasks") },
    ],
  });
}

/* ───────────── Abonnement ───────────── */

export function subscriptionActiveMail(d: { firstName?: string | null; planName: string; seats: number | null; nextBillingAt?: string | Date | null }): MailBody {
  return build(`Votre abonnement ${d.planName} est actif`, {
    preheader: `Merci ! Votre formule ${d.planName} est en place.`,
    blocks: [
      { t: "h", text: "Merci pour votre confiance" },
      { t: "p", text: `${hello(d.firstName)}\n\nVotre abonnement est actif. Voici le récapitulatif :` },
      { t: "kv", rows: [{ k: "Formule", v: d.planName }, { k: "Utilisateurs", v: d.seats === null ? "Illimités" : String(d.seats) }, ...(d.nextBillingAt ? [{ k: "Prochaine facture", v: dateFr(d.nextBillingAt) }] : [])] },
      { t: "cta", label: "Gérer mon abonnement", url: link("/settings/billing") },
      { t: "p", text: "Vos factures sont disponibles à tout moment depuis la page Facturation." },
    ],
  });
}

/** Relance de service : compte créé mais parcours (formule / essai) non terminé. Une seule à ~24 h, une seule à ~72 h, désinscription en un clic. */
export function onboardingReminderMail(d: { firstName?: string | null; orgName: string; step: 1 | 2; trialDays: number; resumeUrl: string; stopUrl: string }): MailBody {
  const last = d.step === 2;
  return build(last ? `Dernier rappel : votre espace ${d.orgName} est en attente` : `Votre espace ${d.orgName} vous attend`, {
    preheader: `Reprenez où vous vous êtes arrêté : il reste la formule, puis ${d.trialDays} jours d'essai.`,
    blocks: [
      { t: "h", text: last ? "Votre espace est toujours en attente" : "Il ne reste que quelques clics" },
      { t: "p", text: `${hello(d.firstName)}\n\nVous avez créé l'espace « ${d.orgName} » mais l'inscription n'est pas terminée : il reste à choisir une formule pour lancer votre essai de ${d.trialDays} jours. Vos informations sont conservées, vous reprenez exactement là où vous vous êtes arrêté.` },
      { t: "list", items: ["Le montant et la date du premier prélèvement s'affichent avant toute validation", "Aucun prélèvement pendant l'essai : la carte sert à le lancer", "Annulation en un clic depuis les paramètres de facturation"] },
      { t: "cta", label: "Reprendre mon inscription", url: d.resumeUrl },
      ...(last ? [{ t: "p" as const, text: "C'est notre dernier message à ce sujet : nous ne vous écrirons plus ensuite." }] : []),
      { t: "link", label: "Ne plus recevoir ces rappels", url: d.stopUrl },
    ],
    footnote: `Message de service lié à l'espace créé avec cette adresse (aucune publicité). ${last ? "C'était le dernier rappel." : "Un seul autre rappel peut suivre."}`,
  });
}

export function trialEndingMail(d: { firstName?: string | null; orgName: string; daysLeft: number; planName?: string | null }): MailBody {
  const j = d.daysLeft <= 1 ? "demain" : `dans ${d.daysLeft} jours`;
  return build(`Votre essai se termine ${j}`, {
    preheader: "Choisissez une formule pour continuer sans interruption.",
    blocks: [
      { t: "h", text: `Votre essai se termine ${j}` },
      { t: "p", text: `${hello(d.firstName)}\n\nL'essai gratuit de « ${d.orgName} » arrive à son terme. ${d.planName ? `Votre formule ${d.planName} prendra le relais automatiquement.` : "Choisissez une formule pour continuer à créer et suivre vos leads."}` },
      { t: "note", text: "Sans abonnement, votre espace passe en lecture seule : vos données sont conservées, mais plus aucune modification n'est possible.", tone: "warning" },
      { t: "cta", label: "Choisir ma formule", url: link("/settings/billing") },
    ],
  });
}

export function trialExpiredMail(d: { firstName?: string | null; orgName: string }): MailBody {
  return build("Votre essai est terminé : l'espace est en lecture seule", {
    preheader: "Réactivez votre espace en un clic. Vos données sont conservées.",
    blocks: [
      { t: "h", text: "Votre essai est terminé" },
      { t: "p", text: `${hello(d.firstName)}\n\nL'essai de « ${d.orgName} » est arrivé à son terme. L'espace est passé en lecture seule : tous vos leads et rendez-vous sont conservés.` },
      { t: "cta", label: "Réactiver mon espace", url: link("/settings/billing") },
    ],
  });
}

export function paymentFailedMail(d: { firstName?: string | null; orgName: string; graceEndsAt: string | Date }): MailBody {
  return build("Le paiement de votre abonnement a échoué", {
    preheader: `Mettez à jour votre carte avant le ${dateFr(d.graceEndsAt)}.`,
    blocks: [
      { t: "h", text: "Le paiement n'est pas passé" },
      { t: "p", text: `${hello(d.firstName)}\n\nNous n'avons pas pu prélever l'abonnement de « ${d.orgName} ». Votre espace reste pleinement utilisable jusqu'au ${dateFr(d.graceEndsAt)}.` },
      { t: "note", text: `Passé cette date, l'espace basculera en lecture seule tant que le paiement n'est pas régularisé.`, tone: "danger" },
      { t: "cta", label: "Mettre à jour mon moyen de paiement", url: link("/settings/billing") },
    ],
  });
}

export function subscriptionCanceledMail(d: { firstName?: string | null; orgName: string; endsAt?: string | Date | null }): MailBody {
  return build("Votre abonnement est résilié", {
    preheader: d.endsAt ? `Accès complet jusqu'au ${dateFr(d.endsAt)}.` : "Vos données restent consultables.",
    blocks: [
      { t: "h", text: "Votre abonnement est résilié" },
      { t: "p", text: `${hello(d.firstName)}\n\nNous avons bien enregistré la résiliation de l'abonnement de « ${d.orgName} ».${d.endsAt ? ` Vous gardez l'accès complet jusqu'au ${dateFr(d.endsAt)}.` : ""} Ensuite, l'espace reste consultable en lecture seule.` },
      { t: "p", text: "Un changement d'avis ? Vous pouvez réactiver votre abonnement à tout moment, sans rien perdre." },
      { t: "cta", label: "Réactiver mon abonnement", url: link("/settings/billing") },
    ],
  });
}

export function seatLimitReachedMail(d: { firstName?: string | null; orgName: string; planName: string; seats: number }): MailBody {
  return build("Toutes vos places utilisateur sont occupées", {
    preheader: `${d.seats} / ${d.seats} utilisateurs sur la formule ${d.planName}.`,
    blocks: [
      { t: "h", text: "Vous avez atteint votre limite" },
      { t: "p", text: `${hello(d.firstName)}\n\n« ${d.orgName} » utilise ses ${d.seats} places sur la formule ${d.planName}. Pour ajouter quelqu'un, passez à la formule supérieure ou ajoutez des utilisateurs en supplément.` },
      { t: "cta", label: "Voir les formules", url: link("/settings/billing") },
    ],
  });
}

/* ───────────── Site public ───────────── */

export function contactConfirmationMail(d: { name?: string | null }): MailBody {
  return build("Nous avons bien reçu votre message", {
    preheader: "Nous vous répondons sous un jour ouvré.",
    blocks: [
      { t: "h", text: "Merci pour votre message" },
      { t: "p", text: `${hello(d.name)}\n\nNotre équipe l'a bien reçu et vous répondra sous un jour ouvré. En attendant, vous pouvez découvrir ${SITE_NAME} en action.` },
      { t: "cta", label: "Voir les tarifs", url: link("/pricing") },
      sign,
    ],
    footnote: "Vous recevez ce message car il a été saisi sur notre formulaire de contact avec cette adresse.",
  });
}

/** Confirmation au prospect d'une page d'acquisition (/lp/*) : essai ou demande de rappel. */
export function landingConfirmationMail(d: { firstName?: string | null; kind: "essai" | "rappel"; trialDays: number }): MailBody {
  if (d.kind === "rappel") {
    return build("Nous vous rappelons dans les meilleurs délais", {
      preheader: "Votre demande de rappel est bien enregistrée.",
      blocks: [
        { t: "h", text: "Demande de rappel enregistrée" },
        { t: "p", text: `${hello(d.firstName)}\n\nMerci, votre demande est bien enregistrée. Un conseiller ${BRAND.name} vous rappelle dans les meilleurs délais, sur le créneau que vous avez indiqué.` },
        { t: "p", text: `En attendant, vous pouvez déjà créer votre espace : ${d.trialDays} jours d'essai pour tout tester avec votre équipe.` },
        { t: "cta", label: "Démarrer l'essai", url: link("/signup") },
        sign,
      ],
      footnote: "Vous recevez ce message car votre adresse a été saisie sur notre formulaire de rappel. Si ce n'est pas vous, ignorez-le : aucune action n'est nécessaire.",
    });
  }
  return build(`Votre essai de ${d.trialDays} jours vous attend`, {
    preheader: "Créez votre espace en quelques minutes.",
    blocks: [
      { t: "h", text: `Testez ${BRAND.name} pendant ${d.trialDays} jours` },
      { t: "p", text: `${hello(d.firstName)}\n\nMerci pour votre intérêt. Votre espace se crée en quelques minutes : vos coordonnées sont déjà prêtes, il ne reste qu'à finaliser l'inscription.` },
      { t: "cta", label: "Créer mon compte", url: link("/signup") },
      sign,
    ],
    footnote: "Vous recevez ce message car votre adresse a été saisie sur notre page d'essai. Si ce n'est pas vous, ignorez-le : aucun compte n'est créé sans vérification de l'adresse.",
  });
}

/** Alerte interne (LEADS_NOTIFY_EMAIL) : un nouveau prospect vient d'une page d'acquisition. Tout est échappé par le moteur de mise en page. */
export function landingNotificationMail(d: { kind: "essai" | "rappel"; name: string; phone: string; phoneDisplay?: string; email: string; company?: string | null; slot?: string | null; trade?: string | null; campaign?: string | null; landingPath?: string | null }): MailBody {
  const label = d.kind === "rappel" ? "Demande de rappel" : "Essai gratuit";
  return build(`${label} : ${d.name}`.slice(0, 90), {
    preheader: `${d.name} · ${d.phoneDisplay ?? d.phone}`,
    blocks: [
      { t: "h", text: label },
      { t: "kv", rows: [
        { k: "Nom", v: d.name },
        { k: "Téléphone", v: d.phoneDisplay ?? d.phone },
        { k: "E-mail", v: d.email },
        ...(d.company ? [{ k: "Entreprise", v: d.company }] : []),
        ...(d.slot ? [{ k: "Créneau souhaité", v: d.slot }] : []),
        ...(d.trade ? [{ k: "Métier", v: d.trade }] : []),
        { k: "Campagne", v: d.campaign || "Aucune (accès direct)" },
        ...(d.landingPath ? [{ k: "Page", v: d.landingPath }] : []),
      ] },
      { t: "cta", label: `Appeler ${d.phoneDisplay ?? d.phone}`, url: `tel:${d.phone}` },
    ],
    footnote: "Notification interne : nouveau prospect issu d'une page d'acquisition.",
  });
}

function apptRows(d: AppointmentMailData): { k: string; v: string }[] {
  return [
    { k: "Lead", v: d.leadName },
    { k: "Date", v: dateTimeFr(d.startsAt) },
    ...(d.address ? [{ k: "Adresse", v: d.address }] : []),
    ...(d.phone ? [{ k: "Téléphone", v: d.phone }] : []),
    ...(d.agentName ? [{ k: "Commercial", v: d.agentName }] : []),
  ];
}

/** Catalogue (aperçu et tests) : un exemple par template. */
export const MAIL_SAMPLES: { id: string; label: string; mail: () => MailBody }[] = (() => {
  const soon = new Date(Date.now() + 26 * 3_600_000);
  const appt: AppointmentMailData = { recipientName: "Camille", leadName: "Marc Lefèvre", startsAt: soon, address: "12 rue des Lilas, 69003 Lyon", phone: "06 12 34 56 78", agentName: "Julien Moreau" };
  return [
    { id: "verification", label: "Code de vérification", mail: () => verificationCodeMail({ code: "482 916".replace(" ", "") }) },
    { id: "welcome", label: "Bienvenue", mail: () => welcomeMail({ firstName: "Sam", orgName: "Énergies Durables SARL", trialDays: 14 }) },
    { id: "member", label: "Accès équipe (membre ajouté)", mail: () => memberAccountMail({ memberName: "Camille Durand", orgName: "Énergies Durables SARL", inviterName: "Sam Martin", roleName: "Commercial", email: "camille@energies-durables.fr", resetUrl: `${siteUrl()}/reset?token_hash=exemple&invite=1` }) },
    { id: "password", label: "Mot de passe oublié", mail: () => passwordResetMail({ firstName: "Sam", resetUrl: `${siteUrl()}/reset?token_hash=exemple` }) },
    { id: "partner", label: "Invitation régie partenaire", mail: () => partnerInviteMail({ parentOrgName: "Énergies Durables SARL", partnerOrgName: "Régie Plein Soleil", inviterName: "Sam Martin", resetUrl: `${siteUrl()}/reset?token_hash=exemple&invite=1` }) },
    { id: "appt-assigned", label: "RDV attribué", mail: () => appointmentAssignedMail(appt) },
    { id: "appt-reminder-day", label: "Rappel de RDV (veille)", mail: () => appointmentReminderMail({ ...appt, when: "day" }) },
    { id: "appt-reminder-hour", label: "Rappel de RDV (1 h avant)", mail: () => appointmentReminderMail({ ...appt, when: "hour" }) },
    { id: "appt-customer", label: "Rappel de RDV au client", mail: () => appointmentCustomerReminderMail({ customerName: "Marc Lefèvre", companyName: "Énergies Durables SARL", startsAt: soon, address: "12 rue des Lilas, 69003 Lyon", agentName: "Julien Moreau", contactPhone: "04 72 00 00 00" }) },
    { id: "appt-cancelled", label: "RDV annulé", mail: () => appointmentCancelledMail(appt) },
    { id: "lead-assigned", label: "Lead attribué", mail: () => leadAssignedMail({ recipientName: "Camille", leadName: "Marc Lefèvre", source: "Meta Ads", phone: "06 12 34 56 78", city: "Lyon", leadUrl: `${siteUrl()}/leads` }) },
    { id: "task", label: "Rappel de tâche", mail: () => taskReminderMail({ recipientName: "Camille", title: "Préparer la visite technique", dueAt: soon, leadName: "Marc Lefèvre" }) },
    { id: "sub-active", label: "Abonnement actif", mail: () => subscriptionActiveMail({ firstName: "Sam", planName: "Pro", seats: 8, nextBillingAt: new Date(Date.now() + 30 * 86_400_000) }) },
    { id: "onboarding-reminder", label: "Relance d'inscription", mail: () => onboardingReminderMail({ firstName: "Sam", orgName: "Énergies Durables SARL", step: 1, trialDays: 14, resumeUrl: link("/onboarding/plan"), stopUrl: link("/api/relance/stop?o=x&t=x") }) },
    { id: "trial-ending", label: "Fin d'essai proche", mail: () => trialEndingMail({ firstName: "Sam", orgName: "Énergies Durables SARL", daysLeft: 3, planName: "Pro" }) },
    { id: "trial-expired", label: "Essai terminé", mail: () => trialExpiredMail({ firstName: "Sam", orgName: "Énergies Durables SARL" }) },
    { id: "payment-failed", label: "Paiement échoué", mail: () => paymentFailedMail({ firstName: "Sam", orgName: "Énergies Durables SARL", graceEndsAt: new Date(Date.now() + 5 * 86_400_000) }) },
    { id: "sub-canceled", label: "Abonnement résilié", mail: () => subscriptionCanceledMail({ firstName: "Sam", orgName: "Énergies Durables SARL", endsAt: new Date(Date.now() + 12 * 86_400_000) }) },
    { id: "seats", label: "Limite d'utilisateurs atteinte", mail: () => seatLimitReachedMail({ firstName: "Sam", orgName: "Énergies Durables SARL", planName: "Pro", seats: 8 }) },
    { id: "contact", label: "Confirmation de contact", mail: () => contactConfirmationMail({ name: "Marc" }) },
    { id: "landing-essai", label: "Confirmation d'essai (page d'acquisition)", mail: () => landingConfirmationMail({ firstName: "Marc", kind: "essai", trialDays: 14 }) },
    { id: "landing-rappel", label: "Confirmation de rappel (page d'acquisition)", mail: () => landingConfirmationMail({ firstName: "Marc", kind: "rappel", trialDays: 14 }) },
    { id: "landing-notif", label: "Alerte interne nouveau prospect", mail: () => landingNotificationMail({ kind: "rappel", name: "Marc Lefèvre", phone: "+33612345678", phoneDisplay: "06 12 34 56 78", email: "marc@exemple.fr", company: "Solaire Lyon", slot: "Le matin", trade: "installateurs", campaign: "google / cpc / pac-lyon", landingPath: "/lp/installateurs" }) },
  ];
})();
