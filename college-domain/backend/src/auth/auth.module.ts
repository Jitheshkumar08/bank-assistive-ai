import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { PasswordService } from './password.service.js'
import { RolesGuard } from './roles.js'
import { SessionGuard } from './session.guard.js'
import { SessionService } from './session.service.js'

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, SessionGuard, RolesGuard],
  exports: [SessionService, SessionGuard, RolesGuard, PasswordService],
})
export class AuthModule {}
