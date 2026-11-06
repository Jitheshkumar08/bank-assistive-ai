import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { StaffActivationController } from './staff-activation.controller.js'
import { StaffInvitationsService } from './staff-invitations.service.js'
import { SuperAdminController } from './super-admin.controller.js'
import { SuperAdminService } from './super-admin.service.js'

@Module({
  imports: [AuthModule],
  controllers: [SuperAdminController, StaffActivationController],
  providers: [StaffInvitationsService, SuperAdminService],
  exports: [StaffInvitationsService],
})
export class StaffModule {}
