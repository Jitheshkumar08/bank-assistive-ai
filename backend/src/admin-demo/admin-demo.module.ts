import { DynamicModule, Logger, Module } from '@nestjs/common';
import { SuggestionsModule } from '../suggestions/suggestions.module';
import { AdminDemoController } from './admin-demo.controller';
import { AdminDemoService } from './admin-demo.service';

/**
 * The development-only personalisation testing dashboard.
 *
 * Registered through `register()` rather than listed directly, because
 * in production it must contribute NOTHING -- no controller, no
 * provider, no route. A request to /api/admin/demo on a production
 * deployment then gets the honest answer that there is no such path,
 * rather than a 403 confirming the feature exists and is merely
 * guarded.
 *
 * `process.env` is read here rather than ConfigService because module
 * composition happens before dependency injection exists. That is the
 * one place in this codebase where it is unavoidable, and it is why
 * AdminDemoService re-checks the same conditions through ConfigService
 * once it is constructed.
 */
@Module({})
export class AdminDemoModule {
  static register(): DynamicModule {
    if (process.env.NODE_ENV === 'production') {
      new Logger(AdminDemoModule.name).log(
        'Personalisation testing dashboard NOT registered: NODE_ENV=production.',
      );

      return { module: AdminDemoModule };
    }

    return {
      module: AdminDemoModule,
      // SuggestionsModule exports SuggestionsService, whose evaluate()
      // is the engine this dashboard previews. Nothing is reimplemented.
      imports: [SuggestionsModule],
      controllers: [AdminDemoController],
      providers: [AdminDemoService],
    };
  }
}
