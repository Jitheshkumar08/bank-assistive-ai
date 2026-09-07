import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Changes to the signed-in account.
 *
 * Every field is optional: a customer changing only their language
 * should not have to resend their name and email, and a form that
 * resends unchanged values invites overwriting a change made elsewhere.
 *
 * `currentPassword` is required only when the email changes. An email
 * address is the account's identity and the route a password reset
 * would take, so changing it on an unattended phone must not be
 * possible.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter your full name.' })
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsIn(['en', 'kn', 'hi'], { message: 'Language must be one of: en, kn, hi.' })
  preferredLanguage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;
}
