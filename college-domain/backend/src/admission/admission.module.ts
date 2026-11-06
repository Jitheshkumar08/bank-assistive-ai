import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ContextModule } from '../context/context.module.js'
import { FeesModule } from '../fees/fees.module.js'
import { AdmissionController } from './admission.controller.js'
import { AdmissionService } from './admission.service.js'

@Module({ imports: [AuthModule, ContextModule, FeesModule], controllers: [AdmissionController], providers: [AdmissionService] })
export class AdmissionModule {}
