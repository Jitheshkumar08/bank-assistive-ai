import { Module } from '@nestjs/common';
import { AiEngineClient } from './ai-engine.client';
import { HttpAiEngineClient } from './http-ai-engine.client';

/**
 * The single swap point on this side of the boundary.
 *
 * A module of its own because two features need the engine: the
 * assistant, which talks to it, and sessions, which tell it when a visit
 * ends. Providing it inside AssistantModule would force SessionsModule
 * to import AssistantModule, which already imports SessionsModule.
 *
 * Tests provide their own implementation of the same abstract class.
 */
@Module({
  providers: [{ provide: AiEngineClient, useClass: HttpAiEngineClient }],
  exports: [AiEngineClient],
})
export class EngineModule {}
