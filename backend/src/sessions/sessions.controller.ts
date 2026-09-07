import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionView, SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  /** Establishes or moves branch context after a QR scan. */
  @Post()
  @HttpCode(HttpStatus.OK)
  establish(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionView> {
    return this.sessionsService.establish(user.id, dto);
  }

  @Get('active')
  findActive(@CurrentUser() user: AuthenticatedUser): Promise<SessionView | null> {
    return this.sessionsService.findActive(user.id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionView> {
    return this.sessionsService.end(user.id, id);
  }
}
