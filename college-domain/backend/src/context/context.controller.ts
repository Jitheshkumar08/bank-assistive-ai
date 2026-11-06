import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { ErrorResponseDto } from '../common/api-error.js'
import { ContextService } from './context.service.js'

export class QrPayloadDto {
  @ApiProperty({ example: 'campusguide:college/nmamit?area=admissions-desk', maxLength: 300, description: 'The raw payload, or a scan link https://<app>/scan?qr=<payload> from a QR code generated in CampusGuide.' })
  @IsString() @MinLength(1) @MaxLength(300)
  payload: string
}

export class CollegeContextDto {
  @ApiProperty({ example: 'nmamit' }) collegeId: string
  @ApiProperty({ example: 'NMAM Institute of Technology' }) collegeName: string
  @ApiProperty({ example: 'NMAMIT' }) shortName: string
  @ApiPropertyOptional({ example: 'admissions-desk', nullable: true, type: String }) area: string | null
}

@ApiTags('context')
@Controller('qr-context')
export class ContextController {
  constructor(private readonly context: ContextService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a scanned QR payload and return the college context', description: 'Establishes context only; it never signs anyone in or returns student data.' })
  @ApiOkResponse({ type: CollegeContextDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'INVALID_QR' })
  validate(@Body() body: QrPayloadDto) {
    return this.context.validate(body.payload)
  }
}
