import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { ApiBadRequestResponse, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Auth } from '../auth/roles.js'
import { CurrentStudent } from '../auth/session.guard.js'
import type { AuthenticatedStudent } from '../auth/session.service.js'
import { ErrorResponseDto } from '../common/api-error.js'
import { RateLimit } from '../common/rate-limit.js'
import { rateLimits } from '../config/app-config.service.js'
import { AdmissionDetailsQueryDto, AdmissionDetailsResponseDto, AdmissionResultResponseDto, AdmissionVerificationDto, CollegeQueryDto } from './admission.dto.js'
import { AdmissionService } from './admission.service.js'

@ApiTags('admission')
@Controller('students/me')
// Student accounts only: staff use the admin API and never see results through the student endpoints.
@Auth('STUDENT')
export class AdmissionController {
  constructor(private readonly admission: AdmissionService) {}

  @Get('admission-details')
  @ApiOperation({
    summary: 'The signed-in student’s own admission details and applicable fee, after a QR scan',
    description: 'No extra credentials: the record is found by the email of the session’s account. The request carries only the scanned college context.',
  })
  @ApiOkResponse({ type: AdmissionDetailsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'INVALID_QR (college or QR placement not active) or VALIDATION_FAILED' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'NO_ADMISSION_RECORD' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'AMBIGUOUS_ADMISSION_RECORD' })
  getDetails(@CurrentStudent() student: AuthenticatedStudent, @Query() query: AdmissionDetailsQueryDto) {
    return this.admission.getDetails(student, query.collegeId, query.area ?? null)
  }

  @Get('admission-result')
  @ApiOperation({ summary: 'The signed-in student’s own verified admission result', description: 'Foundation endpoint: returns data only from imported official records.' })
  @ApiOkResponse({ type: AdmissionResultResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'NOT_VERIFIED (submit the NUCAT reference first) or NOT_FOUND (unknown college).' })
  getResult(@CurrentStudent() student: AuthenticatedStudent, @Query() query: CollegeQueryDto) {
    return this.admission.getResult(student, query.collegeId)
  }

  @Post('admission-verification')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: () => rateLimits.auth, windowMs: 15 * 60 * 1000 })
  @ApiOperation({ summary: 'Verify the NUCAT reference number for the signed-in account and return the result' })
  @ApiOkResponse({ type: AdmissionResultResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'REFERENCE_MISMATCH or VALIDATION_FAILED' })
  verify(@CurrentStudent() student: AuthenticatedStudent, @Body() body: AdmissionVerificationDto) {
    return this.admission.verify(student, body.collegeId, body.nucatReference)
  }
}
