import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { TOKEN_PATTERN } from '../tokens.js'

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

export class EmailDto {
  @ApiProperty({ example: 'student@example.com', maxLength: 254 })
  @Transform(trimLower) @IsEmail({}, { message: 'email must be a valid email address' }) @MaxLength(254)
  email: string
}

export class RegisterDto extends EmailDto {
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, example: 'a long passphrase you will remember' })
  @IsString() @MinLength(PASSWORD_MIN, { message: `password must be at least ${PASSWORD_MIN} characters` }) @MaxLength(PASSWORD_MAX)
  password: string
}

export class LoginDto extends EmailDto {
  @ApiProperty({ maxLength: PASSWORD_MAX })
  @IsString() @MinLength(1, { message: 'password is required' }) @MaxLength(PASSWORD_MAX)
  password: string

  @ApiPropertyOptional({ default: false, description: 'Longer-lived session (REMEMBER_ME_DAYS) instead of SESSION_TTL_HOURS.' })
  @IsOptional() @IsBoolean()
  rememberMe?: boolean
}

export class TokenDto {
  @ApiProperty({ description: 'Single-use token from the emailed link.', example: 'kq3Zx…(43 characters)' })
  @IsString() @Matches(TOKEN_PATTERN, { message: 'token is invalid' })
  token: string
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString() @MinLength(PASSWORD_MIN, { message: `password must be at least ${PASSWORD_MIN} characters` }) @MaxLength(PASSWORD_MAX)
  password: string
}

// ---- Responses ----

export class MessageResponseDto {
  @ApiProperty({ example: 'If this email can be used, we have sent a message with the next step.' }) message: string
}

/** The signed-in account (named "student" for compatibility; staff accounts use the same shape). */
export class StudentDto {
  @ApiProperty({ format: 'uuid' }) id: string
  @ApiProperty({ example: 'student@example.com' }) email: string
  @ApiProperty({ example: true }) emailVerified: boolean
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string
  @ApiProperty({ enum: ['STUDENT', 'COLLEGE_ADMIN', 'SUPER_ADMIN'], description: 'Authorised role from the database; public registration always creates STUDENT.' }) role: string
  @ApiProperty({ type: String, nullable: true, description: 'Staff display name; null for students.' }) displayName: string | null
}

export class StudentResponseDto {
  @ApiProperty({ type: StudentDto }) student: StudentDto
}

export class LoginResponseDto extends StudentResponseDto {
  @ApiProperty({ type: String, format: 'date-time', description: 'When this session expires.' }) expiresAt: string
}

export class VerifyEmailResponseDto {
  @ApiProperty({ example: true }) verified: boolean
}

export class ResetPasswordResponseDto {
  @ApiProperty({ example: true }) passwordReset: boolean
}
