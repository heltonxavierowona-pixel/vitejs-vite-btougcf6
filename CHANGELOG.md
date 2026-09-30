# Journal des corrections

## Paiement par lien Neero (paiements en ligne suspendus)

- Paiements en ligne désactivés par défaut (`PAYMENT_MODE`), code Notch Pay et Stripe conservé pour les réactiver.
- Le client choisit sa formule : demande « en attente de paiement », message « Votre lien de paiement vous sera envoyé sous quelques heures ».
- Notification instantanée à l'administrateur (client, projet, offre, montant) par Telegram ou WhatsApp (CallMeBot), e-mail en secours.
- Écran **/admin/paiements** : coller le lien Neero (envoyé par e-mail, affiché au client, message WhatsApp prêt), valider ou refuser la référence de transaction, historique.
- Le client saisit sa référence ; une référence ne sert qu'une fois ; validation tracée au journal d'audit.
- Échéances : demande de renouvellement créée trois jours avant, liste envoyée à l'administrateur, relances e-mail au client.
- Liens Neero préparés par formule : envoyés instantanément au client dès sa demande (et aux renouvellements).
- E-mails envoyés par Brevo (SMTP).
- Site public et CGV mis à jour ; faux serveur Telegram et scénario de 52 vérifications.

## Paiement par Notch Pay

- Abonnements payés par Notch Pay (MTN Mobile Money, Orange Money, carte), moyen de paiement proposé en premier.
- Retour navigateur et webhook signé (HMAC-SHA256), toujours confirmés par une relecture de la transaction chez Notch Pay.
- Correction : un paiement encore « en attente » au retour sur le site n'est plus marqué échoué et ne perd plus sa formule (le défaut touchait aussi Flutterwave).
- CGV, accueil et confidentialité mis à jour ; faux serveur Notch Pay et scénario de 15 vérifications.

## Site public

- Page d'accueil vitrine (présentation, fonctionnalités, tarifs, questions fréquentes), servie en HTML statique ; un utilisateur connecté est envoyé directement dans son espace (`/espace`).
- Pages conditions générales de vente (dont résiliation et remboursement), confidentialité, mentions légales et contact, exigées par Stripe pour vérifier l'activité.
- Informations de l'éditeur centralisées dans `web/src/lib/brand.ts` ; tarifs affichés vérifiés par un test contre les tarifs facturés.

## Paiement par carte avec Stripe

- Abonnement mensuel par carte via **Stripe Checkout**, renouvelé automatiquement ; Flutterwave reste disponible pour le Mobile Money.
- Webhooks signés et idempotents : activation, renouvellement mensuel, échec de prélèvement (impayé et période de grâce), résiliation.
- Retour navigateur vérifié auprès de Stripe ; une session d'une autre organisation est refusée.
- Changement de formule : nouvel abonnement sur le même client Stripe, ancien arrêté au prorata.
- Résiliation en fin de période, reprise possible, portail client Stripe (carte, factures).
- Relances Mobile Money désactivées pour les abonnements par carte ; filet de sécurité si un webhook est perdu.
- Tests : faux serveur Stripe, 28 vérifications de bout en bout et 8 parcours navigateur.

## Fusion initiale

Fusion des deux archives d'origine (SaaS de facturation, jamais exécuté, et kit de marque Numera) en un seul produit, puis correction et vérification de bout en bout.

## Erreurs de calcul fiscal

- **TVA sous-déclarée après un avoir total.** La facture annulée était exclue de la déclaration *et* l'avoir soustrait : le même montant était retiré deux fois. La facture reste désormais dans sa période, l'avoir vient en déduction dans la sienne.
- **Déclaration périmée déposable.** Une facture validée après le calcul pouvait être oubliée : le dépôt est maintenant refusé tant que la déclaration n'est pas recalculée, et l'écran le signale.
- **Factures datées dans une période déjà déposée** : elles ne seraient jamais déclarées. Leur validation est désormais refusée.
- **Calculs en nombres à virgule flottante** (`gross * (1 - remise)`) : risque d'erreur au centime et de dépassement au-delà de 2^53. Tout le calcul est maintenant entier et exact (BigInt), avec un seul arrondi final.
- **Aperçu du front recopié à la main** depuis le serveur, sans garantie d'égalité. Le moteur est désormais partagé et un test vérifie que les deux copies sont identiques.
- **Achats numérotés dans la série des ventes** (`FA-…`) : chaque facture fournisseur créait un trou dans la numérotation des ventes, point de contrôle fiscal. Les achats ont leur propre séquence (`AC-…`) et la référence du fournisseur.
- **Avoirs sans plafond** : un avoir partiel pouvait dépasser la facture, un avoir total pouvait suivre un avoir partiel, ou être émis sur une facture déjà annulée. Tout est désormais plafonné et contrôlé.
- **Solde dû faux** : les avoirs partiels n'étaient pas déduits des impayés.
- **Montant en lettres fautif** (« soixante-onze », « quatre-vingt » sans *s*, « deux cent » sans *s*, milliards non gérés). Réécrit selon les règles du français et couvert par 33 tests.
- **Déclarations en retard mal comptées** sur le tableau de bord cabinet, et statut « en retard » perdu à chaque recalcul.

## Sécurité

- **Fuite entre organisations** : un administrateur pouvait archiver ou réactiver l'entité d'une *autre* organisation en mettant son identifiant dans l'URL.
- **Rejeu de paiement** : un seul paiement Flutterwave réussi pouvait activer n'importe quel autre abonnement (la référence de transaction n'était pas vérifiée). Le paiement doit aussi appartenir à l'organisation de l'utilisateur.
- **Double prolongation d'abonnement** si le webhook et le retour navigateur arrivaient en même temps.
- **Limitation des tentatives inactive** : le module était configuré mais le guard jamais activé. Connexion limitée à 10 essais par minute, inscription à 10 par heure.
- **Jetons de rafraîchissement stockés en clair**, jamais renouvelés. Ils sont maintenant hachés (SHA-256) et renouvelés à chaque usage.
- **Démarrage possible sans secret JWT**, ce qui aurait permis de forger des jetons. L'API refuse désormais de démarrer.
- **Énumération des e-mails** par mesure du temps de réponse à la connexion.
- **Abonnement suspendu sans effet** : `assertActive()` n'était jamais appelé. La saisie est désormais bloquée, la lecture reste ouverte.
- **Modification d'un brouillon** sans vérifier que le client appartient bien au dossier.
- **Double validation simultanée** d'une facture, qui consommait deux numéros ; même protection pour les règlements et les dépôts.
- **Validation des données** : moyens de paiement libres, remises supérieures à 100 %, statuts arbitraires, montants illimités. Tout est désormais borné.

## Pannes et fonctionnalités cassées

- L'**inscription** renvoyait vers la page de connexion : la session n'était pas chargée avant la redirection.
- Le **PDF de déclaration** renvoyait une erreur 400 : son URL était captée par la route `/:année/:mois`.
- L'**API ne compilait pas** (import de `pdfkit`).
- Un **cabinet ne pouvait créer aucun dossier** : aucun abonnement n'existait après l'inscription.
- Le **retour de paiement** (`/abonnement/retour`) n'existait pas.
- La **date de création** des organisations était réécrite à chaque modification.
- Deux utilisateurs **ne pouvaient pas partager un numéro de téléphone**, avec un message d'erreur incompréhensible.
- **Doublons de facture** si la validation échouait après « Enregistrer et valider ».
- Les **bordures d'urgence** du compte à rebours n'étaient jamais générées par Tailwind, et la **police** IBM Plex n'était jamais appliquée.
- Les **dates** pouvaient être décalées d'un jour selon le fuseau horaire du navigateur.
- Les **PDF** étaient bloqués sur mobile (fenêtre ouverte après un appel réseau).
- Les **libellés de formulaire** étaient mal lus par les lecteurs d'écran.

## Ajouts

- **Marque Numera** intégrée : logo, favicon, titres, pied de page des PDF, page de connexion.
- **Navigation** complète (le README d'origine signalait qu'elle manquait).
- Nouveaux écrans : modification d'un brouillon, catalogue, historique des déclarations, paramètres du dossier, retour de paiement.
- Avoir partiel, paiement de la TVA, majorations de retard estimées, historique d'audit d'une facture (API).
- **Docker Compose** unique (base, API, front) et migrations appliquées au démarrage.
- Tests : 68 tests unitaires et un scénario de bout en bout de 50 vérifications (`api/scripts/smoke-test.py`).
