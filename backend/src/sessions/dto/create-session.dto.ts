import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Establishes or moves the branch context for the caller's visit.
 *
 * This is the one value a branch QR code carries and nothing more. A
 * QR code never carries workflow instructions, assistant behaviour,
 * language settings, or business rules -- it only says which branch the
 * customer is in.
 */
export class CreateSessionDto {
  @IsString()
  @IsNotEmpty({ message: 'branchCode is required.' })
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'branchCode may contain only letters, digits, hyphens and underscores.',
  })
  branchCode!: string;
}
