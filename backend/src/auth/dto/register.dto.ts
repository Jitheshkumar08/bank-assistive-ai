import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(2, { message: 'Enter your full name.' })
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128, { message: 'Password must be at most 128 characters.' })
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{6,20}$/, { message: 'Enter a valid phone number.' })
  phone?: string;

  @IsOptional()
  @IsIn(['en', 'kn', 'hi', 'tcy'], { message: 'Language must be one of: en, kn, hi, tcy.' })
  preferredLanguage?: string;
}
