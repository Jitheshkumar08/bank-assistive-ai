import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Res, StreamableFile } from '@nestjs/common'
import { ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { Auth } from '../auth/roles.js'
import { CurrentAccount } from '../auth/session.guard.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ErrorResponseDto } from '../common/api-error.js'
import { CreateQrPlacementDto, QrPlacementDto } from './qr-codes.dto.js'
import { QrCodesService } from './qr-codes.service.js'

function sendImage(response: Response, image: { body: Buffer; contentType: string; fileName: string }) {
  response.setHeader('Content-Type', image.contentType)
  response.setHeader('Content-Disposition', `attachment; filename="${image.fileName}"`)
  // Rendered per request from the stored placement; never cached by shared caches.
  response.setHeader('Cache-Control', 'private, no-store')
  return new StreamableFile(image.body)
}

/** QR Management for Super Admins: every college, create placements, activate / deactivate, download images. */
@ApiTags('super-admin')
@Controller('super-admin/qr-codes')
@Auth('SUPER_ADMIN')
export class SuperAdminQrCodesController {
  constructor(private readonly qrCodes: QrCodesService) {}

  @Get()
  @ApiOperation({ summary: 'All QR placements with their payload and scan link' })
  @ApiOkResponse({ type: QrPlacementDto, isArray: true, description: '{ items, publicAppUrl }' })
  list() {
    return this.qrCodes.list(null)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a QR placement (college + location id + label); the location id cannot be changed later' })
  @ApiOkResponse({ type: QrPlacementDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'CONFLICT — the college already has a placement with this location id.' })
  create(@CurrentAccount() actor: AuthenticatedAccount, @Body() body: CreateQrPlacementDto) {
    return this.qrCodes.create(actor, body)
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a placement: its printed codes open CampusGuide again' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  activate(@CurrentAccount() actor: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.qrCodes.setActive(actor, id, true)
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a placement: future scans of its codes are rejected; nothing is deleted' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deactivate(@CurrentAccount() actor: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.qrCodes.setActive(actor, id, false)
  }

  @Get(':id/qr.png')
  @ApiOperation({ summary: 'Download the QR code as PNG (1024 px)' })
  @ApiProduces('image/png')
  async png(@Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: Response) {
    return sendImage(response, await this.qrCodes.image(id, 'png', null))
  }

  @Get(':id/qr.svg')
  @ApiOperation({ summary: 'Download the QR code as SVG (for print)' })
  @ApiProduces('image/svg+xml')
  async svg(@Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: Response) {
    return sendImage(response, await this.qrCodes.image(id, 'svg', null))
  }
}

/** QR codes for College Admins: read and download their own college's placements only. */
@ApiTags('college-admin')
@Controller('admin/qr-codes')
@Auth('COLLEGE_ADMIN')
export class CollegeAdminQrCodesController {
  constructor(private readonly qrCodes: QrCodesService) {}

  @Get()
  @ApiOperation({ summary: 'QR placements of the admin’s own college' })
  list(@CurrentAccount() account: AuthenticatedAccount) {
    return this.qrCodes.listForCollegeAdmin(account)
  }

  @Get(':id/qr.png')
  @ApiOperation({ summary: 'Download a QR code of the admin’s own college as PNG' })
  @ApiProduces('image/png')
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown placement or another college’s placement.' })
  async png(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: Response) {
    return sendImage(response, await this.qrCodes.imageForCollegeAdmin(account, id, 'png'))
  }

  @Get(':id/qr.svg')
  @ApiOperation({ summary: 'Download a QR code of the admin’s own college as SVG' })
  @ApiProduces('image/svg+xml')
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown placement or another college’s placement.' })
  async svg(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) response: Response) {
    return sendImage(response, await this.qrCodes.imageForCollegeAdmin(account, id, 'svg'))
  }
}
