import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/jwt-payload.type';
import {
  AssistantService,
  type AssistantReplyView,
  type AssistantSnapshotView,
} from './assistant.service';
import type { EngineAssistance } from './engine/ai-engine.client';
import { AssistanceDto } from './dto/assistance.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SendVoiceDto } from './dto/send-voice.dto';
import { SpeakDto } from './dto/speak.dto';

/**
 * Shape of an uploaded recording.
 *
 * Declared locally rather than pulling in @types/multer for one type:
 * these four fields are all the service reads.
 */
interface UploadedAudio {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
  size: number;
}

/** Ten megabytes is minutes of speech; anything larger is not a question. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * The assistant, for both typed and spoken input.
 *
 * Protected by the global JWT guard like every other route -- there is
 * no @Public() here. The service then checks the visit belongs to the
 * caller before anything reaches the engine.
 */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /**
   * Where the visit's conversation stands, without changing it.
   *
   * For re-syncing the workflow progress after a turn whose reply never
   * arrived -- the engine may have applied it anyway. Read-only, so a GET;
   * never cached, because the answer changes with every turn.
   */
  @Get('sessions/:sessionId/snapshot')
  @Header('Cache-Control', 'no-store')
  snapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<AssistantSnapshotView> {
    return this.assistant.snapshot(user.id, sessionId);
  }

  /**
   * An offer of help, asked for by the browser after the customer has been
   * quiet on a step. A POST because the engine records the offer in the
   * conversation; it never moves the workflow. Never cached.
   */
  @Post('sessions/:sessionId/assistance')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  assistance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: AssistanceDto,
  ): Promise<EngineAssistance> {
    return this.assistant.assistance(user.id, sessionId, dto.avoid ?? null);
  }

  @Post('message')
  @HttpCode(HttpStatus.OK)
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendMessageDto,
  ): Promise<AssistantReplyView> {
    return this.assistant.sendText(user.id, dto.sessionId, dto.text);
  }

  /**
   * Returns the reply as audio for the browser to play.
   *
   * Binary rather than JSON, so the browser can hand it straight to an
   * audio element. The content type is whatever the engine actually
   * produced -- guessing it is how a valid file ends up unplayable.
   */
  @Post('speak')
  @HttpCode(HttpStatus.OK)
  // Generated per request and specific to one customer's reply; it must
  // not linger in any cache.
  @Header('Cache-Control', 'no-store')
  async speak(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SpeakDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const speech = await this.assistant.speak(user.id, dto.sessionId, dto.text);

    response.setHeader('Content-Type', speech.contentType);

    return new StreamableFile(speech.audio);
  }

  @Post('voice')
  @HttpCode(HttpStatus.OK)
  // Kept in memory: the recording is forwarded and dropped, never
  // written to disk.
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  sendVoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendVoiceDto,
    @UploadedFile() audio: UploadedAudio | undefined,
  ): Promise<AssistantReplyView> {
    return this.assistant.sendVoice(user.id, dto.sessionId, {
      buffer: audio?.buffer as Buffer,
      mimetype: audio?.mimetype ?? '',
      originalname: audio?.originalname,
      size: audio?.size ?? 0,
    });
  }
}
