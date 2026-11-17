import { Body, Controller, Header, HttpCode, HttpStatus, Post, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiBadRequestResponse, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiPayloadTooLargeResponse, ApiProduces,
  ApiServiceUnavailableResponse, ApiTags, ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'
import { Auth } from '../auth/roles.js'
import { CurrentStudent } from '../auth/session.guard.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ErrorResponseDto } from '../common/api-error.js'
import { RateLimit } from '../common/rate-limit.js'
import { AssistantMessageDto, AssistantReplyDto, AssistantSpeechDto, AssistantVoiceDto } from './assistant.dto.js'
import { AssistantService, MAX_VOICE_BYTES } from './assistant.service.js'

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

  @Post('voice-messages')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowMs: 60_000 })
  // Guards (session + STUDENT role) run before this interceptor, so an anonymous upload is refused before it is read.
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_VOICE_BYTES, files: 1, fields: 3, parts: 4 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object', required: ['audio', 'language', 'collegeId'],
      properties: {
        audio: { type: 'string', format: 'binary', description: 'The recorded question (webm/ogg/mp4/mpeg/wav, max 5 MB).' },
        language: { type: 'string', enum: ['en', 'kn', 'hi', 'tcy'] },
        collegeId: { type: 'string', example: 'nmamit' },
        area: { type: 'string', example: 'admissions-desk' },
      },
    },
  })
  @ApiOperation({
    summary: 'Ask the CampusGuide assistant by voice',
    description: 'The recording is transcribed by the shared language engine and answered exactly like a typed question. '
      + 'It is never stored or logged. The reply includes what was heard (`transcript`).',
  })
  @ApiOkResponse({ type: AssistantReplyDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_FAILED (no recording, or any extra field), INVALID_FILE or INVALID_QR' })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'VOICE_NOT_UNDERSTOOD (nothing could be heard)' })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto, description: 'FILE_TOO_LARGE' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'ASSISTANT_UNAVAILABLE' })
  sendVoice(@CurrentStudent() account: AuthenticatedAccount, @UploadedFile() audio: Express.Multer.File | undefined, @Body() body: AssistantVoiceDto) {
    return this.assistant.sendVoice(account, body, audio)
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
