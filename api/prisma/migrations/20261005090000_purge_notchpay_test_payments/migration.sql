-- Nettoyage des données de test Notch Pay.
--
-- Seules des clés de TEST Notch Pay ont été configurées : aucun de ces
-- paiements n'a encaissé d'argent réel. Ils faussaient les revenus du
-- tableau de bord administrateur.
--
-- Les abonnements activés par ces faux paiements repassent en essai
-- jusqu'à la même date : aucun client ne perd son accès, mais ils ne
-- comptent plus comme abonnés payants.

UPDATE "subscriptions"
SET "status" = 'TRIALING',
    "provider" = NULL,
    "trialEndsAt" = "currentPeriodEnd",
    "gracePeriodEnd" = NULL
WHERE "provider" = 'NOTCHPAY'
  AND "status" IN ('ACTIVE', 'PAST_DUE', 'CANCELLED');

DELETE FROM "payments" WHERE "provider" = 'NOTCHPAY';
