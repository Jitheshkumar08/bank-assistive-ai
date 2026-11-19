import { Module } from '@nestjs/common';
import { ActivityController, MyActivitiesController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  controllers: [ActivityController, MyActivitiesController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
