import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
}

/** Read access to branches. */
@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive(): Promise<BranchSummary[]> {
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, city: true, address: true },
    });

    return branches;
  }

  async findByCode(code: string): Promise<BranchSummary> {
    const branch = await this.prisma.branch.findFirst({
      where: { code, isActive: true },
      select: { id: true, code: true, name: true, city: true, address: true },
    });

    if (!branch) {
      throw new NotFoundException(`No active branch with code "${code}".`);
    }

    return branch;
  }

}
