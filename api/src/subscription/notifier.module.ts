import { Global, Module } from '@nestjs/common';

import { NotifierService } from './notifier.service';

/** E-mails et notifications, utilisés par l'abonnement et l'authentification. */
@Global()
@Module({
  providers: [NotifierService],
  exports: [NotifierService],
})
export class NotifierModule {}
