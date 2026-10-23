import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * A request for an offer of help, after the customer has gone quiet.
 *
 * Only the id of the last offer shown is accepted, so the next one can be
 * worded differently. Nothing else: the engine decides from the visit
 * whether an offer fits, and in which language.
 */
export class AssistanceDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z_]+\.\d+$/, { message: 'avoid must be an offer id.' })
  avoid?: string;
}
