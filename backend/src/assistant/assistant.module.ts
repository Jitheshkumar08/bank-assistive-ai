import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { EngineModule } from './engine/engine.module';
import { InterpreterController } from './interpreter.controller';
import { InterpreterService } from './interpreter.service';

@Module({
  imports: [SessionsModule, EngineModule],
  controllers: [AssistantController, InterpreterController],
  providers: [AssistantService, InterpreterService],
  exports: [AssistantService],
})
export class AssistantModule {}
