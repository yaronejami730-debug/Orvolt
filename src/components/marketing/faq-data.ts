import { PLANS, TRIAL_DAYS, formatPrice } from "@/lib/billing/plans";
import { SITE_NAME } from "@/lib/site";

export type FaqItem = { q: string; a: string };

/** Réponse sécurité des paiements (accueil, tarifs, schema.org FAQPage). Faits vérifiés : Stripe Checkout hébergé, aucun champ de carte dans l'application, portail client Stripe. */
export const PAYMENT_SECURITY_ANSWER = "Oui. Tous les paiements passent par Stripe, un prestataire de paiement certifié PCI DSS niveau 1. Vous réglez sur la page de paiement hébergée par Stripe : vos coordonnées bancaires ne transitent pas par nos serveurs et ne sont jamais stockées par Orvolt. L'authentification 3-D Secure est demandée lorsque votre banque l'exige. La facturation, le changement de carte et la résiliation se gèrent depuis le portail de facturation.";

export const FAQ: FaqItem[] = [
  { q: "Quelle différence entre Starter et Pro ?", a: "Sur Starter, toute l'équipe travaille ensemble avec deux rôles : l'Administrateur, qui gère tout, et le Membre, qui saisit et suit les leads et son agenda. Sur Pro, chaque personne a un rôle adapté à son métier (prospecteur, confirmateur, commercial, poseur) et voit ce qui la concerne. Pendant l'essai, tous les rôles sont disponibles." },
  { q: "Comment fonctionne l'essai gratuit ?", a: `Vous choisissez d'abord le plan qui correspond au nombre d'utilisateurs, puis vous testez ${SITE_NAME} ${TRIAL_DAYS} jours avec votre équipe, avec toutes les fonctionnalités. À la fin de l'essai, l'abonnement choisi démarre ; vous pouvez le résilier avant. Vos données restent en place.` },
  { q: "Puis-je annuler à tout moment ?", a: "Oui. L'abonnement est sans engagement, mensuel ou annuel (2 mois offerts à l'année). Vous résiliez depuis le portail de facturation, et l'accès reste ouvert jusqu'à la fin de la période payée." },
  { q: "Mes paiements sont-ils sécurisés ?", a: PAYMENT_SECURITY_ANSWER },
  { q: "Mes données sont-elles sécurisées et conformes au RGPD ?", a: "Chaque entreprise a son espace, séparé des autres, et chaque rôle n'accède qu'à ce qui le concerne. Peu de données collectées, journaux conservés peu de temps, export et suppression sur demande." },
  { q: "Puis-je adapter l'outil à mon activité ?", a: "Oui, c'est le but. Vous partez du modèle énergie (pompe à chaleur, panneaux solaires, isolation), puis vous changez les statuts, les passages autorisés, les champs, les sources et les droits de chaque rôle." },
  { q: "Comment importer mes leads existants ?", a: "Vous déposez un fichier CSV. L'assistant repère les colonnes, vous les associez aux champs, simule l'import et vous remet un rapport d'erreurs. Les leads Meta Lead Ads et Google Ads arrivent seuls grâce aux webhooks." },
  { q: "Quels moyens de paiement acceptez-vous ?", a: "Carte bancaire ou Apple Pay, via Stripe. Vous changez de carte et téléchargez vos factures depuis le portail de facturation." },
  { q: "Comment fonctionne la répartition automatique des rendez-vous ?", a: "Dès que le confirmateur valide, le moteur propose le commercial et l'heure de chaque rendez-vous : zone d'intervention (rayon autour de la base et temps de route réel), horaires du commercial, trajet entre deux rendez-vous. Vous voyez la proposition avant de la valider." },
  { q: "Orvolt convient-il à un installateur de panneaux solaires ou de pompes à chaleur ?", a: "Oui. Le modèle énergie (pompe à chaleur, panneaux solaires, isolation) est créé à l'inscription avec ses statuts, ses champs sur le logement et ses sources de leads. Vous pouvez tout adapter à votre façon de vendre." },
  { q: "Puis-je gérer plusieurs régies ou partenaires ?", a: "Oui. Chaque régie partenaire a son propre espace, ses rôles et ses membres, et ne voit jamais votre régie. Vous y accédez à tout moment en tant que super administrateur ; ses utilisateurs comptent dans vos places." },
];

/** FAQ de la page tarifs. Aucun montant de palier ici : la grille complète du Premium est dans les CGV. */
export const PRICING_FAQ: FaqItem[] = [
  { q: "Quelle différence entre Starter et Pro ?", a: "Sur Starter, toute l'équipe travaille ensemble avec deux rôles : l'Administrateur, qui gère tout, et le Membre, qui saisit et suit les leads et son agenda. Sur Pro, chaque personne a un rôle adapté à son métier (prospecteur, confirmateur, commercial, poseur) et voit ce qui la concerne. Pendant l'essai, tous les rôles sont disponibles." },
  { q: "Puis-je changer de formule ?", a: "Oui, à tout moment depuis Paramètres > Facturation. Le changement est proratisé : vous ne payez que la différence sur la période en cours." },
  { q: "Et si j'ai besoin de plus d'utilisateurs ?", a: `Sur Starter, Pro et Business, vous ajoutez des utilisateurs en supplément (${formatPrice(PLANS.starter.extraSeatCents!)} par mois sur Starter, ${formatPrice(PLANS.pro.extraSeatCents!)} sur Pro, ${formatPrice(PLANS.business.extraSeatCents!)} sur Business), quel que soit leur rôle (prospecteur, confirmateur ou commercial). Plus la formule est haute, moins l'utilisateur en plus coûte : dès que votre équipe grandit, la formule supérieure revient moins cher. Vous les ajoutez ou les retirez à tout moment dans Paramètres > Facturation, au prorata. Le Premium inclut des utilisateurs illimités.` },
  { q: "Comment fonctionne le tarif dégressif du Premium ?", a: "Votre tarif baisse par paliers d'ancienneté continue : plus vous restez abonné, moins vous payez. Le nouveau prix s'applique automatiquement à la facture suivante, sans démarche. L'abonnement annuel compte dans l'ancienneté et fait progresser les paliers. La grille complète figure dans nos CGV, et chaque facture indique le prix exact facturé du mois." },
  { q: "Que se passe-t-il si je résilie ?", a: "Vous résiliez en un clic depuis le portail de facturation et gardez l'accès jusqu'à la fin de la période payée. Si vous reprenez ensuite un Premium, votre tarif repart au prix de départ et l'ancienneté recommence." },
  { q: "Mes paiements sont-ils sécurisés ?", a: PAYMENT_SECURITY_ANSWER },
];
