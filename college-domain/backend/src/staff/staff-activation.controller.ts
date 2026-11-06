import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ErrorResponseDto } from '../common/api-error.js'
import { RateLimit } from '../common/rate-limit.js'
import { rateLimits } from '../config/app-config.service.js'
import { AcceptInvitationDto, InvitationTokenDto } from './staff.dto.js'
import { StaffInvitationsService } from './staff-invitations.service.js'

const authLimit = { limit: () => rateLimits.auth, windowMs: 15 * 60 * 1000 }

/** Public endpoints behind the emailed staff activation link; the single-use token is the only credential. */
@ApiTags('auth')
@Controller('auth/invitations')
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'INVALID_OR_EXPIRED_TOKEN or VALIDATION_FAILED' })
export class StaffActivationController {
  constructor(private readonly invitations: StaffInvitationsService) {}

  @Post('inspect')
  @HttpCode(HttpStatus.OK)
  @RateLimit(authLimit)
  @ApiOperation({ summary: 'Who an activation link is for (does not use up the link)' })
  inspect(@Body() body: InvitationTokenDto) {
    return this.invitations.inspect(body.token)
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @RateLimit(authLimit)
  @ApiOperation({ summary: 'Set a password and activate the invited staff account', description: 'The role comes from the invitation record, never from the request.' })
  accept(@Body() body: AcceptInvitationDto) {
    return this.invitations.accept(body.token, body.password)
  }
}
