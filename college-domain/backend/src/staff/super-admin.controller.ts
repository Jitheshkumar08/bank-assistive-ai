import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiConflictResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger'
import { Auth } from '../auth/roles.js'
import { CurrentAccount } from '../auth/session.guard.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ErrorResponseDto } from '../common/api-error.js'
import { AccessChangeDto, AuditQueryDto, InviteCollegeAdminDto } from './staff.dto.js'
import { StaffInvitationsService } from './staff-invitations.service.js'
import { SuperAdminService } from './super-admin.service.js'

/** Staff account management. Super Admin only — College Admins can never reach these routes. */
@ApiTags('super-admin')
@Controller('super-admin')
@Auth('SUPER_ADMIN')
export class SuperAdminController {
  constructor(private readonly superAdmin: SuperAdminService, private readonly invitations: StaffInvitationsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Counts of College Admins and invitations, active colleges and recent administrative activity' })
  overview() {
    return this.superAdmin.overview()
  }

  @Get('college-admins')
  @ApiOperation({ summary: 'College Admin accounts and their pending / expired / revoked invitations' })
  list() {
    return this.superAdmin.listCollegeAdmins()
  }

  @Post('college-admins/invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a College Admin by name and email (sends a single-use activation link)' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The email already has an account or a pending invitation.' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'EMAIL_PROVIDER_NOT_CONFIGURED — nothing is created.' })
  invite(@CurrentAccount() actor: AuthenticatedAccount, @Body() body: InviteCollegeAdminDto) {
    return this.invitations.inviteCollegeAdmin(actor, body)
  }

  @Post('college-admins/invitations/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a new activation link (the previous one stops working)' })
  resend(@CurrentAccount() actor: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invitations.resend(actor, id)
  }

  @Post('college-admins/invitations/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revoke(@CurrentAccount() actor: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invitations.revoke(actor, id)
  }

  @Post('college-admins/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a College Admin (blocks sign-in and ends all sessions)' })
  suspend(@CurrentAccount() actor: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: AccessChangeDto) {
    return this.superAdmin.suspend(actor, id, body.reason)
  }

  @Post('college-admins/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore access for a suspended College Admin' })
  restore(@CurrentAccount() actor: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: AccessChangeDto) {
    return this.superAdmin.restore(actor, id, body.reason)
  }

  @Get('audit-events')
  @ApiOperation({ summary: 'Audit log (read-only; entries are created server-side and cannot be changed through the API)' })
  auditEvents(@Query() query: AuditQueryDto) {
    return this.superAdmin.auditEvents(query)
  }
}
