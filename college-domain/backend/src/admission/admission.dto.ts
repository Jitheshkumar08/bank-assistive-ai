import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class CollegeQueryDto {
  @ApiProperty({ example: 'nmamit' })
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: 'collegeId is invalid' })
  collegeId: string
}

export class AdmissionVerificationDto extends CollegeQueryDto {
  @ApiProperty({ example: 'NUCAT reference as printed on your application', minLength: 3, maxLength: 40 })
  // Students often paste references with surrounding spaces; trim before validating.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MinLength(3) @MaxLength(40) @Matches(/^[A-Za-z0-9][A-Za-z0-9 /-]*$/, { message: 'nucatReference may contain only letters, digits, spaces, "/" and "-"' })
  nucatReference: string
}

/** The signed-in student's own result, exactly as recorded in the official admission data. */
export class AdmissionResultDto {
  @ApiProperty({ example: 'Name as in the official record' }) studentName: string
  @ApiProperty({ type: Number, nullable: true, description: 'Null until ranks are published.' }) nucatRank: number | null
  @ApiProperty({ type: String, nullable: true, description: 'Null until a branch is allocated.' }) allocatedBranch: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) admissionStatus: string | null
  @ApiProperty({ example: 2025 }) admissionYear: number
  @ApiProperty({ type: String, format: 'date-time' }) verifiedAt: string
}

export class AdmissionResultResponseDto {
  @ApiProperty({ type: AdmissionResultDto }) result: AdmissionResultDto
}

/** The scanned college context only: which college and (optionally) which approved QR placement. Never identity. */
export class AdmissionDetailsQueryDto extends CollegeQueryDto {
  @ApiPropertyOptional({ example: 'admissions-desk', description: 'Area slug from the scanned QR code; re-checked so a deactivated QR placement opens nothing.' })
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, { message: 'area is invalid' })
  area?: string
}

/** Only the final payable amount is exposed; the breakdown, category and scholarship handling stay in the backend. */
export class FeeDetailsDto {
  @ApiProperty({ enum: ['CONFIRMED', 'REQUIRES_CONFIRMATION'] }) status: 'CONFIRMED' | 'REQUIRES_CONFIRMATION'
  @ApiPropertyOptional({ example: 'INR', description: 'Only when status = CONFIRMED.' }) currency?: 'INR'
  @ApiPropertyOptional({ example: 360000, description: 'Only when status = CONFIRMED. Whole rupees, calculated by the backend from the official fee schedule for the record’s branch, admission year and official fee category.' }) finalPayableAmount?: number
}

/** The signed-in student's own admission details, found by the session account's email in the official records. */
export class AdmissionDetailsDto {
  @ApiProperty({ example: 'Name as in the official record' }) studentName: string
  @ApiProperty({ type: Number, nullable: true, description: 'Null until ranks are published.' }) nucatRank: number | null
  @ApiProperty({ type: String, nullable: true, description: 'Null until a branch is allocated.' }) allocatedBranch: string | null
  @ApiPropertyOptional({ type: String, nullable: true }) admissionStatus: string | null
  @ApiProperty({ example: 2026 }) admissionYear: number
  @ApiProperty({ type: FeeDetailsDto }) fee: FeeDetailsDto
}

export class AdmissionDetailsResponseDto {
  @ApiProperty({ type: AdmissionDetailsDto }) details: AdmissionDetailsDto
}
