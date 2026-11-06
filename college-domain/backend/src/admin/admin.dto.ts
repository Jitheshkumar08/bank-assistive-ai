import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value)
/** Empty string → null so a field can be cleared explicitly in an edit. */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? null : value)

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) page: number = 1
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20
}

export class StudentRecordQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Student name (contains) or NUCAT reference (starts with).', maxLength: 80 })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) search?: string

  @ApiPropertyOptional({ example: 2025 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) admissionYear?: number
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() branchId?: string
  @ApiPropertyOptional({ description: 'Exact status text (case-insensitive).' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(80) status?: string

  @ApiPropertyOptional({ enum: ['nucatReference', 'studentName', 'admissionYear', 'nucatRank', 'admissionStatus', 'updatedAt'], default: 'nucatReference' })
  @IsOptional() @IsIn(['nucatReference', 'studentName', 'admissionYear', 'nucatRank', 'admissionStatus', 'updatedAt'])
  sort: 'nucatReference' | 'studentName' | 'admissionYear' | 'nucatRank' | 'admissionStatus' | 'updatedAt' = 'nucatReference'

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' }) @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'asc'
}

/** Editable official fields. NUCAT reference and admission year identify the record and cannot be edited. */
export class UpdateStudentRecordDto {
  @ApiProperty({ description: 'updatedAt of the record as last loaded; the edit is refused if someone changed it since.' })
  @IsISO8601() expectedUpdatedAt: string

  @ApiProperty({ minLength: 5, maxLength: 300, description: 'Why the official data is being corrected (stored in the audit log).' })
  @Transform(trim) @IsString() @MinLength(5, { message: 'reason must be at least 5 characters' }) @MaxLength(300) reason: string

  @ApiPropertyOptional({ maxLength: 160 }) @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(160)
  @Matches(/^[^\p{Cc}<>]+$/u, { message: 'studentName contains characters that are not allowed' }) studentName?: string

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null = not published.' })
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) nucatRank?: number | null

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'null = not allocated.' })
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() allocatedBranchId?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 })
  @IsOptional() @Transform(blankToNull) @Transform(trim) @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(80) admissionStatus?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  @IsOptional() @Transform(blankToNull) @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @ValidateIf((_, value) => value !== null) @IsEmail({}, { message: 'officialEmail must be a valid email address' }) @MaxLength(254) officialEmail?: string | null
}

export class ImportPreviewDto {
  @ApiProperty({ example: 2025, description: 'Admission year the whole file belongs to.' })
  @Type(() => Number) @IsInt({ message: 'admissionYear must be a year' }) @Min(2000) @Max(2100) admissionYear: number
}

export class ImportCommitDto {
  @ApiProperty({ enum: ['SKIP_EXISTING', 'UPDATE_EXISTING'], description: 'What to do with rows that already exist for the same year.' })
  @IsIn(['SKIP_EXISTING', 'UPDATE_EXISTING']) duplicatePolicy: 'SKIP_EXISTING' | 'UPDATE_EXISTING'
}

export class ImportListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 2025 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) admissionYear?: number
}

export class ImportRowsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'issues', 'valid', 'invalid', 'duplicate', 'new', 'changed', 'unchanged'], default: 'all' })
  @IsOptional() @IsIn(['all', 'issues', 'valid', 'invalid', 'duplicate', 'new', 'changed', 'unchanged'])
  filter: 'all' | 'issues' | 'valid' | 'invalid' | 'duplicate' | 'new' | 'changed' | 'unchanged' = 'all'
}

export class ReportQueryDto {
  @ApiPropertyOptional({ enum: ['issues', 'all'], default: 'issues' }) @IsOptional() @IsIn(['issues', 'all']) scope: 'issues' | 'all' = 'issues'
}
