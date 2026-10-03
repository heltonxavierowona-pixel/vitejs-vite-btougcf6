import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { EntityService } from './entity.service';
import {
  AssignCollaboratorDto,
  CreateEntityDto,
  UpdateEntityDto,
} from './dto/entity.dto';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/context.decorator';

/**
 * Ces routes ne passent pas par le TenancyGuard : on y crée des
 * entités qui n'existent pas encore. L'appartenance est donc
 * vérifiée dans le service, explicitement.
 */
@Controller('organizations/:organizationId/entities')
@UseGuards(AuthGuard)
export class EntityController {
  constructor(private readonly entities: EntityService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    return this.entities.list(user.id, organizationId);
  }

  @Get(':entityId')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Param('entityId') entityId: string,
  ) {
    return this.entities.findOne(user.id, organizationId, entityId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateEntityDto,
  ) {
    return this.entities.create(user.id, organizationId, dto);
  }

  @Put(':entityId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Param('entityId') entityId: string,
    @Body() dto: UpdateEntityDto,
  ) {
    return this.entities.update(user.id, organizationId, entityId, dto);
  }

  /** Archivage — les données restent consultables. */
  @Delete(':entityId')
  archive(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Param('entityId') entityId: string,
  ) {
    return this.entities.archive(user.id, organizationId, entityId);
  }

  @Post(':entityId/restore')
  restore(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Param('entityId') entityId: string,
  ) {
    return this.entities.restore(user.id, organizationId, entityId);
  }

  @Post('assignments')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: AssignCollaboratorDto,
  ) {
    return this.entities.assignCollaborator(
      user.id,
      organizationId,
      dto.membershipId,
      dto.entityIds,
    );
  }
}
