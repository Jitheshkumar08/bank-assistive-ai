import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ResolveContextDto } from './dto/resolve-context.dto';

export interface ResolvedContext {
  branch: {
    id: string;
    code: string;
    name: string;
    city: string | null;
  };
}

/**
 * Turns a scanned QR payload into a validated branch.
 *
 * This is the whole responsibility. Resolving context does not create a
 * session, start a workflow, or talk to the AI engine -- those are
 * separate concerns owned by separate modules.
 */
@Injectable()
export class ContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(dto: ResolveContextDto): Promise<ResolvedContext> {
    const branch = await this.prisma.branch.findFirst({
      where: { code: dto.branchCode, isActive: true },
      select: { id: true, code: true, name: true, city: true },
    });

    if (!branch) {
      throw new NotFoundException(
        `Branch "${dto.branchCode}" was not recognised. Please scan the QR code again.`,
      );
    }

    return { branch };
  }
}
