import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { ActivityService } from './activity.service';
import { ConfirmActivityDto } from './dto/confirm-activity.dto';
import type { ActivityHistoryItemView, ConfirmActivityView } from './types/activity.types';

/**
 * Assisted activities: the review screen, and the customer's own record.
 *
 * Nothing here moves money. Confirming records that the customer agreed
 * with the details and wants to go on, and the response says where they
 * go next -- the existing assistant conversation.
 */
@Controller('assistant/activities')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get(':activityId')
  @Header('Cache-Control', 'no-store')
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('activityId', new ParseUUIDPipe({ version: '4' })) activityId: string,
  ) {
    return this.activity.review(user.id, activityId);
  }

  @Post(':activityId/confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('activityId', new ParseUUIDPipe({ version: '4' })) activityId: string,
    @Body() dto: ConfirmActivityDto,
  ): Promise<ConfirmActivityView> {
    return this.activity.confirm(user.id, activityId, dto);
  }
}

/** The customer's own history, under their account rather than a visit. */
@Controller('me/activities')
export class MyActivitiesController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  history(@CurrentUser() user: AuthenticatedUser): Promise<ActivityHistoryItemView[]> {
    return this.activity.history(user.id);
  }

  @Delete()
  forget(@CurrentUser() user: AuthenticatedUser): Promise<{ deleted: number }> {
    return this.activity.forget(user.id);
  }
}
