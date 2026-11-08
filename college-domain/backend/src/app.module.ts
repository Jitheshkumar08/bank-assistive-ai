import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { AdminModule } from './admin/admin.module.js'
import { AdmissionModule } from './admission/admission.module.js'
import { AssistantModule } from './assistant/assistant.module.js'
import { AuditModule } from './audit/audit.module.js'
import { AuthModule } from './auth/auth.module.js'
import { AllExceptionsFilter } from './common/all-exceptions.filter.js'
import { RateLimitGuard } from './common/rate-limit.js'
import { AppConfigModule } from './config/config.module.js'
import { ContextModule } from './context/context.module.js'
import { EmailModule } from './email/email.module.js'
import { HealthController } from './health/health.controller.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { QrCodesModule } from './qr-codes/qr-codes.module.js'
import { StaffModule } from './staff/staff.module.js'

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuditModule,
    EmailModule,
    AuthModule,
    ContextModule,
    AdmissionModule,
    AssistantModule,
    StaffModule,
    AdminModule,
    QrCodesModule,
  ],
  controllers: [HealthController],
  providers: [
    // Default: 120 requests/minute per client; sensitive auth routes set stricter per-route limits.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
