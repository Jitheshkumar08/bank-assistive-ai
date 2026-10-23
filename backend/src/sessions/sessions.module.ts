import { Module } from '@nestjs/common';
import { EngineModule } from '../assistant/engine/engine.module';
import { ContextModule } from '../context/context.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [ContextModule, EngineModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
