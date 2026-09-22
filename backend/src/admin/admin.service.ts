import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

/** A branch as the staff screen shows it: the record, plus how used it is. */
export interface AdminBranch {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  isActive: boolean;
  /** Visits ever started at this branch. */
  totalVisits: number;
  /** Visits open right now. */
  activeVisits: number;
  /** ISO timestamp of the most recent visit, or null if there has been none. */
  lastVisitAt: string | null;
}

export interface AdminOverview {
  branches: { total: number; active: number };
  customers: number;
  visits: { active: number; today: number };
}

const BRANCH_FIELDS = {
  id: true,
  code: true,
  name: true,
  city: true,
  address: true,
  isActive: true,
} as const;

/**
 * Everything the staff screen can do to branches.
 *
 * Kept apart from BranchesService, which is the customer-facing read of
 * active branches only. The two answer different questions for different
 * audiences, and merging them would leave a deactivated branch one
 * missing guard away from being offered to a customer.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listBranches(): Promise<AdminBranch[]> {
    const branches = await this.prisma.branch.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        ...BRANCH_FIELDS,
        _count: { select: { sessions: true } },
        sessions: { select: { startedAt: true }, orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });

    // One grouped query rather than a count per branch: this list is
    // read on every page load of the staff screen.
    const openVisits = await this.prisma.session.groupBy({
      by: ['branchId'],
      where: { status: SessionStatus.ACTIVE },
      _count: { _all: true },
    });

    const openByBranch = new Map(openVisits.map((row) => [row.branchId, row._count._all]));

    return branches.map((branch) => ({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      city: branch.city,
      address: branch.address,
      isActive: branch.isActive,
      totalVisits: branch._count.sessions,
      activeVisits: openByBranch.get(branch.id) ?? 0,
      lastVisitAt: branch.sessions[0]?.startedAt.toISOString() ?? null,
    }));
  }

  async findBranch(id: string): Promise<AdminBranch> {
    const branch = (await this.listBranches()).find((candidate) => candidate.id === id);

    if (!branch) {
      throw new NotFoundException('That branch no longer exists.');
    }

    return branch;
  }

  async createBranch(dto: CreateBranchDto): Promise<AdminBranch> {
    try {
      const created = await this.prisma.branch.create({
        data: {
          code: dto.code,
          name: dto.name,
          city: dto.city || null,
          address: dto.address || null,
        },
        select: BRANCH_FIELDS,
      });

      return { ...created, totalVisits: 0, activeVisits: 0, lastVisitAt: null };
    } catch (error) {
      // The code column is unique, so two people adding the same branch
      // at once land here rather than in a check-then-write race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A branch with that code already exists.');
      }

      throw error;
    }
  }

  async updateBranch(id: string, dto: UpdateBranchDto): Promise<AdminBranch> {
    const data: Prisma.BranchUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    // An emptied field clears the value rather than storing a blank.
    if (dto.city !== undefined) data.city = dto.city || null;
    if (dto.address !== undefined) data.address = dto.address || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      await this.prisma.branch.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('That branch no longer exists.');
      }

      throw error;
    }

    return this.findBranch(id);
  }

  /**
   * Removes a branch outright, which is only ever safe before anyone has
   * used it.
   *
   * A branch with visits is part of the record of those visits, so it is
   * deactivated instead. That stops new scans resolving to it while
   * leaving its history intact.
   */
  async deleteBranch(id: string): Promise<void> {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      select: { id: true, _count: { select: { sessions: true } } },
    });

    if (!branch) {
      throw new NotFoundException('That branch no longer exists.');
    }

    if (branch._count.sessions > 0) {
      throw new ConflictException(
        'This branch has visits recorded against it. Deactivate it instead of deleting it.',
      );
    }

    await this.prisma.branch.delete({ where: { id } });
  }

  async overview(): Promise<AdminOverview> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [total, active, customers, openVisits, todayVisits] = await this.prisma.$transaction([
      this.prisma.branch.count(),
      this.prisma.branch.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
      this.prisma.session.count({ where: { status: SessionStatus.ACTIVE } }),
      this.prisma.session.count({ where: { startedAt: { gte: startOfToday } } }),
    ]);

    return {
      branches: { total, active },
      customers,
      visits: { active: openVisits, today: todayVisits },
    };
  }
}
