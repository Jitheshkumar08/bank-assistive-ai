import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ContextModule } from '../context/context.module.js'
import { FeesModule } from '../fees/fees.module.js'
import { AdmissionController } from './admission.controller.js'
import { AdmissionService } from './admission.service.js'

// AdmissionService is exported for the assistant (Phase 6), which must use exactly the Result page's lookup rules.
@Module({ imports: [AuthModule, ContextModule, FeesModule], controllers: [AdmissionController], providers: [AdmissionService], exports: [AdmissionService] })
export class AdmissionModule {}
