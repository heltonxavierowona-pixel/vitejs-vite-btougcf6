import { Module } from '@nestjs/common';

import { EntityController } from './entity.controller';
import { EntityService } from './entity.service';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [SubscriptionModule],
  controllers: [EntityController],
  providers: [EntityService],
  exports: [EntityService],
})
export class EntityModule {}
