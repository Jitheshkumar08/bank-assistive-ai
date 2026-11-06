import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConflictResponse, ApiConsumes, ApiOperation, ApiPayloadTooLargeResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { Auth } from '../auth/roles.js'
import { CurrentAccount } from '../auth/session.guard.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ErrorResponseDto } from '../common/api-error.js'
import { RateLimit } from '../common/rate-limit.js'
import { rateLimits } from '../config/app-config.service.js'
import {
  ImportCommitDto, ImportListQueryDto, ImportPreviewDto, ImportRowsQueryDto, ReportQueryDto, StudentRecordQueryDto, UpdateStudentRecordDto,
} from './admin.dto.js'
import { AdminDashboardService } from './admin-dashboard.service.js'
import { AdmissionImportService } from './imports/admission-import.service.js'
import { MAX_IMPORT_BYTES } from './imports/spreadsheet-parser.js'
import { StudentRecordsService } from './student-records.service.js'

/** College Admin API. Every query is scoped to the admin's own college; students and Super Admins get 403. */
@ApiTags('college-admin')
@Controller('admin')
@Auth('COLLEGE_ADMIN')
export class AdminController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly records: StudentRecordsService,
    private readonly imports: AdmissionImportService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Totals, records per admission year, import outcomes, data-quality counts and recent activity' })
  summary(@CurrentAccount() account: AuthenticatedAccount) {
    return this.dashboard.summary(account)
  }

  // ───────────── Student records ─────────────

  @Get('student-records')
  @ApiOperation({ summary: 'Search, filter, sort and page official admission records' })
  listRecords(@CurrentAccount() account: AuthenticatedAccount, @Query() query: StudentRecordQueryDto) {
    return this.records.list(account, query)
  }

  @Get('student-records/filters')
  @ApiOperation({ summary: 'Admission years, branches and statuses present in this college’s records' })
  recordFilters(@CurrentAccount() account: AuthenticatedAccount) {
    return this.records.filters(account)
  }

  @Get('student-records/:id')
  @ApiOperation({ summary: 'One admission record' })
  getRecord(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.records.get(account, id)
  }

  @Patch('student-records/:id')
  @ApiOperation({ summary: 'Correct official fields (reason required; refused if the record changed since it was loaded)' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'CONFLICT — the record changed after it was loaded.' })
  updateRecord(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateStudentRecordDto) {
    return this.records.update(account, id, body)
  }

  @Get('student-records/:id/history')
  @ApiOperation({ summary: 'Change history of one record (imports, edits, student verification)' })
  recordHistory(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.records.history(account, id)
  }

  @Get('admission-years')
  @ApiOperation({ summary: 'Admission years in the shared admissions table with counts and latest import' })
  years(@CurrentAccount() account: AuthenticatedAccount) {
    return this.records.years(account)
  }

  // ───────────── Admission imports ─────────────

  @Get('admission-imports/columns')
  @ApiOperation({ summary: 'Recognised spreadsheet columns, limits and import rules' })
  importColumns() {
    return this.imports.columns()
  }

  @Get('admission-imports/template.csv')
  @ApiOperation({ summary: 'Empty CSV with the recognised column headers' })
  template(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', 'attachment; filename="admission-import-template.csv"')
    return this.imports.templateCsv()
  }

  @Post('admission-imports/preview')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: () => rateLimits.imports, windowMs: 15 * 60 * 1000 })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 4, parts: 6 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'admissionYear'], properties: { file: { type: 'string', format: 'binary' }, admissionYear: { type: 'integer', example: 2025 } } } })
  @ApiOperation({ summary: 'Upload an .xlsx/.csv (max 5 MB, 10,000 rows): parse and validate it; nothing official changes yet' })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto, description: 'FILE_TOO_LARGE' })
  preview(@CurrentAccount() account: AuthenticatedAccount, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: ImportPreviewDto) {
    return this.imports.preview(account, file, body.admissionYear)
  }

  @Get('admission-imports')
  @ApiOperation({ summary: 'Import history' })
  listImports(@CurrentAccount() account: AuthenticatedAccount, @Query() query: ImportListQueryDto) {
    return this.imports.list(account, query)
  }

  @Get('admission-imports/:id')
  @ApiOperation({ summary: 'One import: status, counts, detected columns and notices' })
  getImport(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.imports.get(account, id)
  }

  @Get('admission-imports/:id/rows')
  @ApiOperation({ summary: 'Parsed rows with validation messages' })
  importRows(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: ImportRowsQueryDto) {
    return this.imports.rows(account, id, query)
  }

  @Get('admission-imports/:id/report.csv')
  @ApiOperation({ summary: 'Download the validation report as CSV' })
  async report(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: ReportQueryDto, @Res({ passthrough: true }) response: Response) {
    const { fileName, csv } = await this.imports.reportCsv(account, id, query.scope)
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    return csv
  }

  @Post('admission-imports/:id/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a previewed import with an explicit duplicate policy (one transaction; can run only once)' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'IMPORT_ALREADY_PROCESSED, IMPORT_PREVIEW_EXPIRED or IMPORT_STALE' })
  commit(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: ImportCommitDto) {
    return this.imports.commit(account, id, body.duplicatePolicy)
  }

  @Post('admission-imports/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discard a preview that is awaiting confirmation' })
  cancel(@CurrentAccount() account: AuthenticatedAccount, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.imports.cancel(account, id)
  }
}
