import { HttpStatus, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { actorTypeFor, requireInstitution } from '../auth/roles.js'
import type { AuthenticatedAccount } from '../auth/session.service.js'
import { ApiError } from '../common/api-error.js'
import { AppConfig } from '../config/app-config.service.js'
import { buildQrPayload, buildScanLink } from '../context/context.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { CreateQrPlacementDto, QrPlacementDto } from './qr-codes.dto.js'
import { contentTypes, renderQr, type QrImageFormat } from './qr-image.js'

const select = {
  id: true, institutionId: true, areaSlug: true, label: true, isActive: true, createdAt: true, updatedAt: true,
  institution: { select: { id: true, name: true, shortName: true } },
  createdBy: { select: { displayName: true, email: true } },
} as const

type Row = Prisma.InstitutionQrCodeGetPayload<{ select: typeof select }>

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'This QR placement does not exist.')

/**
 * QR placements (where a printed code is used) and their images. Super Admins see and manage every placement;
 * College Admins only read and download their own college's. The payload is always rebuilt from the stored
 * institution id + area slug, which never change, so regenerating an image never changes what a code means.
 */
@Injectable()
export class QrCodesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly config: AppConfig) {}

  /** `institutionId` = null → every college (Super Admin). */
  async list(institutionId: string | null) {
    const rows = await this.prisma.institutionQrCode.findMany({
      where: institutionId ? { institutionId } : {}, select, orderBy: [{ institutionId: 'asc' }, { isActive: 'desc' }, { label: 'asc' }],
    })
    return { items: rows.map((row) => this.present(row)), publicAppUrl: this.config.frontendOrigin }
  }

  listForCollegeAdmin(account: AuthenticatedAccount) {
    return this.list(requireInstitution(account))
  }

  async create(actor: AuthenticatedAccount, input: CreateQrPlacementDto) {
    const institution = await this.prisma.institution.findFirst({ where: { id: input.institutionId, isActive: true }, select: { id: true } })
    if (!institution) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Choose an active college.', [{ field: 'institutionId', messages: ['Choose an active college.'] }])
    const duplicate = () => new ApiError(HttpStatus.CONFLICT, 'CONFLICT', `A QR placement with the location id "${input.areaSlug}" already exists for this college. Reactivate it instead of creating a new one.`)
    if (await this.prisma.institutionQrCode.findUnique({ where: { institutionId_areaSlug: { institutionId: input.institutionId, areaSlug: input.areaSlug } }, select: { id: true } })) throw duplicate()
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.institutionQrCode.create({
          data: { institutionId: input.institutionId, areaSlug: input.areaSlug, label: input.label, createdById: actor.id }, select,
        })
        await this.audit.record({
          actorType: actorTypeFor(actor.role), actorId: actor.id, action: 'QR_PLACEMENT_CREATED', entityType: 'InstitutionQrCode', entityId: created.id,
          metadata: { institutionId: created.institutionId, areaSlug: created.areaSlug, label: created.label },
        }, tx)
        return created
      })
      return this.present(row)
    } catch (error) {
      // A concurrent create of the same (college, area) trips the unique constraint.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicate()
      throw error
    }
  }

  /** Activating/deactivating is the only change allowed; it never deletes the placement or touches its identifiers. */
  async setActive(actor: AuthenticatedAccount, id: string, isActive: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.institutionQrCode.findUnique({ where: { id }, select })
      if (!current) throw notFound()
      if (current.isActive === isActive) return this.present(current)
      const updated = await tx.institutionQrCode.update({ where: { id }, data: { isActive }, select })
      await this.audit.record({
        actorType: actorTypeFor(actor.role), actorId: actor.id, action: isActive ? 'QR_PLACEMENT_ACTIVATED' : 'QR_PLACEMENT_DEACTIVATED',
        entityType: 'InstitutionQrCode', entityId: id, metadata: { institutionId: updated.institutionId, areaSlug: updated.areaSlug, label: updated.label },
      }, tx)
      return this.present(updated)
    })
  }

  /** `institutionId` = null → any college (Super Admin); otherwise a placement of another college is "not found". */
  async image(id: string, format: QrImageFormat, institutionId: string | null) {
    const row = await this.prisma.institutionQrCode.findFirst({ where: { id, ...(institutionId ? { institutionId } : {}) }, select: { institutionId: true, areaSlug: true } })
    if (!row) throw notFound()
    const body = await renderQr(this.scanUrl(row.institutionId, row.areaSlug), format)
    return { body, contentType: contentTypes[format], fileName: `campusguide-qr-${row.institutionId}-${row.areaSlug}.${format}` }
  }

  imageForCollegeAdmin(account: AuthenticatedAccount, id: string, format: QrImageFormat) {
    return this.image(id, format, requireInstitution(account))
  }

  private scanUrl(institutionId: string, areaSlug: string) {
    return buildScanLink(this.config.frontendOrigin, buildQrPayload(institutionId, areaSlug))
  }

  private present(row: Row): QrPlacementDto {
    const payload = buildQrPayload(row.institutionId, row.areaSlug)
    return {
      id: row.id, institution: row.institution, areaSlug: row.areaSlug, label: row.label, isActive: row.isActive, payload,
      scanUrl: buildScanLink(this.config.frontendOrigin, payload), createdBy: row.createdBy ? (row.createdBy.displayName ?? row.createdBy.email) : null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }
  }
}
