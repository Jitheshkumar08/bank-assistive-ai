import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { TOKEN_PATTERN } from '../auth/tokens.js'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class InviteCollegeAdminDto {
  @ApiProperty({ example: 'Staff member name', maxLength: 120 })
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) @Matches(/^[^\p{Cc}<>]+$/u, { message: 'displayName contains characters that are not allowed' })
  displayName: string

  @ApiProperty({ example: 'staff@example.edu', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail({}, { message: 'email must be a valid email address' }) @MaxLength(254)
  email: string

  @ApiProperty({ example: 'nmamit', description: 'College the admin will manage.' })
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: 'institutionId is invalid' })
  institutionId: string
}

export class AccessChangeDto {
  @ApiPropertyOptional({ maxLength: 300, description: 'Optional reason, stored in the audit log.' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300)
  reason?: string
}

export class InvitationTokenDto {
  @ApiProperty({ description: 'Single-use token from the activation link.' })
  @IsString() @Matches(TOKEN_PATTERN, { message: 'token is invalid' })
  token: string
}

export class AcceptInvitationDto extends InvitationTokenDto {
  @ApiProperty({ minLength: 12, maxLength: 128, description: 'At least 12 characters (16 for a Super Admin).' })
  @IsString() @MinLength(12, { message: 'password must be at least 12 characters' }) @MaxLength(128)
  password: string
}

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page: number = 1
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 25
  @ApiPropertyOptional({ enum: ['STUDENT', 'ADMIN', 'SUPER_ADMIN', 'SYSTEM'] })
  @IsOptional() @IsIn(['STUDENT', 'ADMIN', 'SUPER_ADMIN', 'SYSTEM']) actorType?: 'STUDENT' | 'ADMIN' | 'SUPER_ADMIN' | 'SYSTEM'
  @ApiPropertyOptional({ description: 'Exact action name, e.g. COLLEGE_ADMIN_INVITED.' })
  @IsOptional() @IsString() @Matches(/^[A-Z_]{3,80}$/, { message: 'action is invalid' }) action?: string
  @ApiPropertyOptional({ description: 'Entity type, e.g. InstitutionQrCode for QR Management events.' })
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3,60}$/, { message: 'entityType is invalid' }) entityType?: string
}
