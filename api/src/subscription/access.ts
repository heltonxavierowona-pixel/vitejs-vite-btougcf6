import { Subscription, SubscriptionStatus } from '@prisma/client';

/**
 * Un abonnement permet-il encore de TRAVAILLER (saisir, valider,
 * déclarer) ? La consultation, elle, reste toujours ouverte : on
 * ne prend jamais en otage les données comptables d'un client.
 *
 * - Essai ou actif : oui.
 * - Impayé : oui pendant la période de grâce — on ne coupe pas
 *   l'accès la veille d'une échéance fiscale.
 * - Résilié : oui jusqu'à la fin de la période déjà payée.
 * - Suspendu, ou aucun abonnement : non.
 */
export function canUseSubscription(
  subscription: Pick<
    Subscription,
    'status' | 'currentPeriodEnd' | 'gracePeriodEnd'
  > | null,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;

  switch (subscription.status) {
    case SubscriptionStatus.ACTIVE:
    case SubscriptionStatus.TRIALING:
      return true;
    case SubscriptionStatus.PAST_DUE:
      return !!subscription.gracePeriodEnd && subscription.gracePeriodEnd > now;
    case SubscriptionStatus.CANCELLED:
      return subscription.currentPeriodEnd > now;
    default:
      return false;
  }
}

export const SUBSCRIPTION_BLOCKED_MESSAGE =
  'Votre abonnement est suspendu : vos données restent consultables, ' +
  'mais la saisie est bloquée. Renouvelez-le depuis la page Abonnement.';
