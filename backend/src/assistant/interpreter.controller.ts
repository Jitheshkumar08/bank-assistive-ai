import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
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
import { InterpreterService } from './interpreter.service';
import {
  InterpreterSpeakDto,
  InterpreterTranscribeDto,
  InterpreterTranslateDto,
} from './dto/interpreter.dto';
import type {
  EngineInterpreterLanguage,
  EngineInterpreterTranscript,
  EngineInterpreterTranslated,
} from './engine/ai-engine.client';

/** The four fields of an upload the service reads. */
interface UploadedAudio {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Same ceiling as a voice turn. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * The face-to-face interpreter, under the assistant's route prefix.
 *
 * Protected by the global JWT guard like every other route. Recognition,
 * translation and speech only: no route here reaches the conversation.
 */
@Controller('assistant/interpreter')
export class InterpreterController {
  constructor(private readonly interpreter: InterpreterService) {}

  @Get('languages')
  @Header('Cache-Control', 'no-store')
  languages(): Promise<EngineInterpreterLanguage[]> {
    return this.interpreter.languages();
  }

  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  // Kept in memory: forwarded and dropped, never written to disk.
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  transcribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InterpreterTranscribeDto,
    @UploadedFile() audio: UploadedAudio | undefined,
  ): Promise<EngineInterpreterTranscript> {
    return this.interpreter.transcribe(user.id, dto.sessionId, dto.language, {
      buffer: audio?.buffer as Buffer,
      mimetype: audio?.mimetype ?? '',
      size: audio?.size ?? 0,
    });
  }

  @Post('translate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  translate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InterpreterTranslateDto,
  ): Promise<EngineInterpreterTranslated> {
    return this.interpreter.translate(
      user.id,
      dto.sessionId,
      dto.text,
      dto.sourceLanguage,
      dto.targetLanguage,
    );
  }

  @Post('speak')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async speak(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InterpreterSpeakDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const speech = await this.interpreter.speak(user.id, dto.sessionId, dto.text, dto.language);

    response.setHeader('Content-Type', speech.contentType);

    return new StreamableFile(speech.audio);
  }
}
