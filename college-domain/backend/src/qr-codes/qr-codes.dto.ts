import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class CreateQrPlacementDto {
  @ApiProperty({ example: 'nmamit', description: 'Active college the placement belongs to.' })
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: 'institutionId is invalid' })
  institutionId: string

  @ApiProperty({ example: 'library', description: 'Short location id printed in the QR code: lower-case letters, digits and "-". It cannot be changed later.' })
  @Transform(trim) @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, { message: 'areaSlug must be 1–40 lower-case letters, digits or "-", starting with a letter or digit' })
  areaSlug: string

  @ApiProperty({ example: 'Central Library entrance', minLength: 2, maxLength: 120 })
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) @Matches(/^[^\u0000-\u001f\u007f<>]+$/, { message: 'label contains characters that are not allowed' })
  label: string
}

export class QrPlacementDto {
  @ApiProperty() id: string
  @ApiProperty({ example: { id: 'nmamit', name: 'NMAM Institute of Technology', shortName: 'NMAMIT' } }) institution: { id: string; name: string; shortName: string }
  @ApiProperty({ example: 'admissions-desk' }) areaSlug: string
  @ApiProperty({ example: 'Admission desk' }) label: string
  @ApiProperty() isActive: boolean
  @ApiProperty({ example: 'campusguide:college/nmamit?area=admissions-desk', description: 'Context payload (identical for every code of this placement).' }) payload: string
  @ApiProperty({ example: 'https://campusguide.example/scan?qr=campusguide%3Acollege%2Fnmamit%3Farea%3Dadmissions-desk', description: 'What generated QR images encode (FRONTEND_ORIGIN + /scan).' }) scanUrl: string
  @ApiProperty({ type: String, nullable: true, description: 'Super Admin who created it; null for seeded / earlier placements.' }) createdBy: string | null
  @ApiProperty({ format: 'date-time' }) createdAt: string
  @ApiProperty({ format: 'date-time' }) updatedAt: string
}
