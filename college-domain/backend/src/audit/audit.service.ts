import { Injectable } from '@nestjs/common'
import type { AuditActorType, Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

type Db = Pick<PrismaService, 'auditEvent'> | Prisma.TransactionClient

export type AuditInput = {
  actorType: AuditActorType
  actorId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  /** Small, non-sensitive context only — never passwords, tokens, or full request bodies. */
  metadata?: Prisma.InputJsonValue
}

/** Append-only audit trail; pass a transaction client to record inside the same transaction. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: AuditInput, db: Db = this.prisma) {
    return db.auditEvent.create({ data: { ...input, actorId: input.actorId ?? null, entityId: input.entityId ?? null } })
  }
}
