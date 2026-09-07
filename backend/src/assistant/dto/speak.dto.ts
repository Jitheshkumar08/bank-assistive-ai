import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * A request to read a reply aloud.
 *
 * Note what is absent: no language. The visit already knows which
 * language the customer is being served in, and letting a browser
 * override it would mean a Kannada speaker could be answered in an
 * English voice by a tampered client.
 */
export class SpeakDto {
  @IsUUID(undefined, { message: 'sessionId must be a valid session identifier.' })
  sessionId!: string;

  @IsString()
  @IsNotEmpty({ message: 'There is nothing to read out.' })
  @MaxLength(2000, { message: 'That response is too long to read out.' })
  text!: string;
}
