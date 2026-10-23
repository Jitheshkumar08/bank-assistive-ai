import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { EngineModule } from './engine/engine.module';

@Module({
  imports: [SessionsModule, EngineModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
