import { Global, Module } from '@nestjs/common';

import { NeeroProvider } from './neero/neero.provider';

/** Passerelles de paiement disponibles pour tous les modules. */
@Global()
@Module({
  providers: [NeeroProvider],
  exports: [NeeroProvider],
})
export class PaymentsModule {}
