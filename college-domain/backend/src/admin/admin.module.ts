import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { AdminDashboardService } from './admin-dashboard.service.js'
import { AdminController } from './admin.controller.js'
import { AdmissionImportService } from './imports/admission-import.service.js'
import { StudentRecordsService } from './student-records.service.js'

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminDashboardService, StudentRecordsService, AdmissionImportService],
})
export class AdminModule {}
