import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { AssistedActivitySource } from './history/assisted-activity.source';
import { DemoHistorySource } from './history/demo-history.source';
import { PAYMENT_HISTORY_SOURCES } from './history/history-source.interface';
import { SuggestionsController } from './suggestions.controller';
import { SuggestionsService } from './suggestions.service';

/**
 * The sources are listed here and nowhere else.
 *
 * Adding a genuine bank transaction feed is one more class and one more
 * entry in this array. The detectors, the service and the API stay as
 * they are, which is the whole point of keeping the port.
 */
@Module({
  imports: [SessionsModule],
  controllers: [SuggestionsController],
  providers: [
    SuggestionsService,
    DemoHistorySource,
    AssistedActivitySource,
    {
      provide: PAYMENT_HISTORY_SOURCES,
      useFactory: (demo: DemoHistorySource, assisted: AssistedActivitySource) => [
        demo,
        assisted,
      ],
      inject: [DemoHistorySource, AssistedActivitySource],
    },
  ],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
