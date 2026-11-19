import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { EngineModule } from './engine/engine.module';
import { InterpreterController } from './interpreter.controller';
import { InterpreterService } from './interpreter.service';

@Module({
  // Upstream's interpreter tier and our activity recorder both belong
  // here: AssistantService injects ActivityService, InterpreterService
  // injects SessionsService and AiEngineClient.
  imports: [SessionsModule, EngineModule, ActivityModule],
  controllers: [AssistantController, InterpreterController],
  providers: [AssistantService, InterpreterService],
  exports: [AssistantService],
})
export class AssistantModule {}
