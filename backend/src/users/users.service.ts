import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, SessionStatus, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

/** Columns safe to return over the API. Never includes passwordHash. */
export const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  preferredLanguage: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Full record including the hash. Used only by authentication, which
   * needs the hash to verify a password. Everything else uses the
   * public projection.
   */
  async findByEmailWithHash(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  /** Full record for the signed-in customer, when a password must be checked. */
  async findByIdWithHash(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, isActive: true } });
  }

  async findPublicById(id: string): Promise<AuthenticatedUser | null> {
    return this.prisma.user.findFirst({
      where: { id, isActive: true },
      select: PUBLIC_USER_FIELDS,
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<AuthenticatedUser> {
    return this.prisma.user.create({
      data: { ...data, email: data.email.toLowerCase() },
      select: PUBLIC_USER_FIELDS,
    });
  }

  /**
   * Applies a customer's own changes to their account.
   *
   * The active visit's language moves with the account's. A visit
   * normally keeps the language it started with -- re-scanning at
   * another counter must not silently switch languages mid-conversation
   * -- but this is the customer deliberately asking, and leaving the
   * assistant speaking the old language until their next visit would
   * read as the setting being broken.
   */
  async updateProfile(
    id: string,
    changes: { fullName?: string; email?: string; preferredLanguage?: string },
  ): Promise<AuthenticatedUser> {
    const data: Prisma.UserUpdateInput = {};

    if (changes.fullName !== undefined) data.fullName = changes.fullName;
    if (changes.email !== undefined) data.email = changes.email.toLowerCase();
    if (changes.preferredLanguage !== undefined) {
      data.preferredLanguage = changes.preferredLanguage;
    }

    try {
      const [user] = await this.prisma.$transaction([
        this.prisma.user.update({ where: { id }, data, select: PUBLIC_USER_FIELDS }),
        this.prisma.session.updateMany({
          where: { userId: id, status: SessionStatus.ACTIVE },
          // updateMany with an empty data object is a no-op, so an
          // unchanged language costs nothing.
          data:
            changes.preferredLanguage !== undefined
              ? { language: changes.preferredLanguage }
              : {},
        }),
      ]);

      return user;
    } catch (error) {
      // The email column is unique. Racing two sign-ups for the same
      // address reaches here rather than the check in the service.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An account with that email already exists.');
      }

      throw error;
    }
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async upsertAdminUser(
    email: string,
    passwordHash: string,
    fullName = 'Administrator',
  ): Promise<AuthenticatedUser> {
    return this.prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: { passwordHash, isActive: true },
      create: {
        email: email.toLowerCase(),
        fullName,
        passwordHash,
        preferredLanguage: 'en',
      },
      select: PUBLIC_USER_FIELDS,
    });
  }
}
