import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AiEngineClient } from './engine/ai-engine.client';
import { HttpAiEngineClient } from './engine/http-ai-engine.client';

@Module({
  imports: [SessionsModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    // The single swap point on this side of the boundary. Tests provide
    // their own implementation of the same abstract class.
    { provide: AiEngineClient, useClass: HttpAiEngineClient },
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
