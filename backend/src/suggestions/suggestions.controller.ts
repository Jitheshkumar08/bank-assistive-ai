import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { SuggestionsService } from './suggestions.service';
import type { ContinueSuggestionView, SuggestionListView } from './types/suggestions.types';

/**
 * Remembered payments for the welcome screen.
 *
 * Everything is scoped to the caller's own open visit. Nothing here is
 * cacheable: a suggestion is about one customer at one moment, and a
 * cached copy could be served to the next person on a shared branch
 * device.
 */
@Controller('assistant/suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ): Promise<SuggestionListView> {
    return this.suggestions.list(user.id, sessionId);
  }

  /**
   * Accepts a suggestion.
   *
   * No body: the payee and the amount are read from the server's own
   * offer row, so a tampered client cannot name a destination.
   */
  @Post(':offerId/continue')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  continue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', new ParseUUIDPipe({ version: '4' })) offerId: string,
  ): Promise<ContinueSuggestionView> {
    return this.suggestions.continueOffer(user.id, offerId);
  }

  @Post(':offerId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offerId', new ParseUUIDPipe({ version: '4' })) offerId: string,
  ): Promise<void> {
    return this.suggestions.decline(user.id, offerId);
  }
}
