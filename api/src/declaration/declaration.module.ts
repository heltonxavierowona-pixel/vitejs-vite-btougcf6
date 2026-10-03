import { Module } from '@nestjs/common';

import { DeclarationController } from './declaration.controller';
import { DeclarationService } from './declaration.service';

@Module({
  controllers: [DeclarationController],
  providers: [DeclarationService],
  exports: [DeclarationService],
})
export class DeclarationModule {}
