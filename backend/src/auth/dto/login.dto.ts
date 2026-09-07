import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(255)
  email!: string;

  // Length is bounded but not shape-checked: login must never hint at
  // what a valid password looks like, and an over-long value should be
  // rejected before it reaches the hashing function.
  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(128)
  password!: string;
}
