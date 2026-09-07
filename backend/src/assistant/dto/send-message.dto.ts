import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * A typed message from the customer.
 *
 * The session id is supplied by the client but never trusted: the
 * service confirms the visit belongs to the caller and is still open
 * before anything reaches the engine.
 */
export class SendMessageDto {
  @IsUUID(undefined, { message: 'sessionId must be a valid session identifier.' })
  sessionId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter a message.' })
  @MaxLength(4000, { message: 'That message is too long.' })
  text!: string;
}
