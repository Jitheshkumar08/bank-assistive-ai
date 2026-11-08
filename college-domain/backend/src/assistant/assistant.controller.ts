import { Body, Controller, Header, HttpCode, HttpStatus, Post, StreamableFile } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger'
import { Auth } from '../auth/roles.js'
import { CurrentStudent } from '../auth/session.guard.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ErrorResponseDto } from '../common/api-error.js'
import { RateLimit } from '../common/rate-limit.js'
import { AssistantMessageDto, AssistantReplyDto, AssistantSpeechDto } from './assistant.dto.js'
import { AssistantService } from './assistant.service.js'

@ApiTags('assistant')
@Controller('assistant')
// Signed-in students only (identity and role from the session cookie, checked on every request).
@Auth('STUDENT')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Ask the CampusGuide assistant',
    description: 'The question, language and scanned college context go to the shared language engine. Student data is '
      + 'never taken from the request: an admission-status question is answered from the signed-in student’s own official record.',
  })
  @ApiOkResponse({ type: AssistantReplyDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_FAILED (incl. any student field in the body) or INVALID_QR' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'ASSISTANT_UNAVAILABLE' })
  sendMessage(@CurrentStudent() account: AuthenticatedAccount, @Body() body: AssistantMessageDto) {
    return this.assistant.sendMessage(account, body)
  }

  @Post('speech')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read an assistant reply aloud', description: 'Only a reply given to this session, in the language it was given in.' })
  @ApiProduces('audio/mpeg')
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_FAILED (not a reply from this conversation)' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'ASSISTANT_UNAVAILABLE' })
  async speak(@CurrentStudent() account: AuthenticatedAccount, @Body() body: AssistantSpeechDto) {
    const { audio, contentType } = await this.assistant.speak(account, body.text)
    return new StreamableFile(audio, { type: contentType, length: audio.length })
  }
}
