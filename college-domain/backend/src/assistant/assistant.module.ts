import { Module } from '@nestjs/common'
import { AdmissionModule } from '../admission/admission.module.js'
import { AuthModule } from '../auth/auth.module.js'
import { ContextModule } from '../context/context.module.js'
import { AssistantAdmissionStatusService } from './admission-status.service.js'
import { AssistantController } from './assistant.controller.js'
import { AssistantService } from './assistant.service.js'
import { CollegeEngineClient, HttpCollegeEngineClient } from './engine/college-engine.client.js'

/**
 * Phase 6: the CampusGuide assistant (Student Portal chat → College backend → shared language engine). Reuses the
 * portal's AdmissionService (through the Phase 5 AssistantAdmissionStatusService) and ContextService; adds no second
 * admission lookup and no second authentication.
 */
@Module({
  imports: [AuthModule, ContextModule, AdmissionModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantAdmissionStatusService, { provide: CollegeEngineClient, useClass: HttpCollegeEngineClient }],
})
export class AssistantModule {}
