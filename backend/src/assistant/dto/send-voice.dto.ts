import { IsUUID } from 'class-validator';

/**
 * The form fields accompanying a recording.
 *
 * The audio itself arrives as multipart and is validated separately --
 * size and presence are checked before it is read into memory.
 */
export class SendVoiceDto {
  @IsUUID(undefined, { message: 'sessionId must be a valid session identifier.' })
  sessionId!: string;
}
