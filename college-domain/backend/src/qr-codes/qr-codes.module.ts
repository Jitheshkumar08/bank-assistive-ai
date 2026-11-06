import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { CollegeAdminQrCodesController, SuperAdminQrCodesController } from './qr-codes.controller.js'
import { QrCodesService } from './qr-codes.service.js'

@Module({ imports: [AuthModule], controllers: [SuperAdminQrCodesController, CollegeAdminQrCodesController], providers: [QrCodesService] })
export class QrCodesModule {}
