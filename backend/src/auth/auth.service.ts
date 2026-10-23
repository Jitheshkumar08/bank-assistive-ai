import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthenticatedUser, JwtPayload } from './types/jwt-payload.type';

export interface AuthResult {
  accessToken: string;
  expiresIn: string;
  user: AuthenticatedUser;
}

/** One message for every failed sign-in, so it never reveals which half was wrong. */
const INVALID_CREDENTIALS = 'Email or password is incorrect.';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  /**
   * A real hash of a throwaway value, verified against when no account
   * matches. Without it, a missing email would answer noticeably faster
   * than a wrong password and expose which emails are registered.
   */
  private decoyHash = '';

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.decoyHash = await this.passwordService.hash('decoy-value-never-used-to-sign-in');

    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD');

    if (adminEmail && adminPassword) {
      await this.syncAdminAccount(adminEmail, adminPassword);
    }
  }

  /**
   * Makes the ADMIN_EMAIL account match the configuration -- and writes
   * nothing when it already does.
   *
   * This runs on every boot. Upserting unconditionally rewrote the row
   * each time, with a freshly salted hash of the same password, so merely
   * starting the API modified the database.
   *
   * The stored password is reused only when it verifiably matches.
   * PasswordService.verify() answers false for anything it cannot check,
   * so a corrupt or foreign hash is replaced rather than trusted.
   */
  private async syncAdminAccount(email: string, password: string): Promise<void> {
    const existing = await this.usersService.findByEmailWithHash(email);

    const passwordMatches =
      existing !== null && (await this.passwordService.verify(existing.passwordHash, password));

    if (existing && passwordMatches && existing.role === Role.ADMIN && existing.isActive) {
      this.logger.log(`Admin account already up to date: ${email}`);
      return;
    }

    // A matching password keeps its hash, so correcting only the role or
    // the active flag does not churn the credential.
    const passwordHash =
      existing && passwordMatches ? existing.passwordHash : await this.passwordService.hash(password);

    await this.usersService.upsertAdminUser(email, passwordHash, 'Administrator');
    this.logger.log(`Admin account ${existing ? 'updated' : 'created'}: ${email}`);
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmailWithHash(dto.email);

    if (existing) {
      throw new ConflictException('An account with that email already exists.');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.usersService.create({
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
      phone: dto.phone,
      preferredLanguage: dto.preferredLanguage ?? 'en',
    });

    return this.issueToken(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const record = await this.usersService.findByEmailWithHash(dto.email);

    // Always run a verification, even with no account, so both paths
    // cost the same.
    const matches = await this.passwordService.verify(
      record?.passwordHash ?? this.decoyHash,
      dto.password,
    );

    if (!record || !record.isActive || !matches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.issueToken({
      id: record.id,
      email: record.email,
      fullName: record.fullName,
      preferredLanguage: record.preferredLanguage,
      role: record.role,
    });
  }

  /**
   * Applies a customer's own changes to their account.
   *
   * Changing the email address requires the current password. The
   * address is the account's identity and the route any future reset
   * would take, so someone who picks up an unlocked phone must not be
   * able to point the account at themselves. A name or a language is
   * not that, and demanding a password to switch to Kannada would be
   * friction with nothing behind it.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthResult> {
    const record = await this.usersService.findByIdWithHash(userId);

    if (!record) {
      throw new UnauthorizedException('Your session is no longer valid. Please sign in again.');
    }

    const email = dto.email?.trim().toLowerCase();
    const isChangingEmail = email !== undefined && email !== record.email;

    if (isChangingEmail) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Enter your current password to change your email address.');
      }

      const matches = await this.passwordService.verify(
        record.passwordHash,
        dto.currentPassword,
      );

      if (!matches) {
        throw new UnauthorizedException('That password is not correct.');
      }
    }

    const user = await this.usersService.updateProfile(userId, {
      fullName: dto.fullName?.trim(),
      // Sent only when it actually changed, so an unchanged address
      // never touches the unique index.
      email: isChangingEmail ? email : undefined,
      preferredLanguage: dto.preferredLanguage,
    });

    // A fresh token: the old one carries the previous email in its
    // claims, and handing back a token that disagrees with the account
    // is the kind of thing that surfaces months later.
    return this.issueToken(user);
  }

  /**
   * Changes the password, after proving the old one is known.
   *
   * Tokens already issued stay valid until they expire -- they are
   * stateless and there is no revocation list -- so this is not a way to
   * evict a device that has one. It is a way to stop the old password
   * working.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<AuthResult> {
    const record = await this.usersService.findByIdWithHash(userId);

    if (!record) {
      throw new UnauthorizedException('Your session is no longer valid. Please sign in again.');
    }

    const matches = await this.passwordService.verify(record.passwordHash, dto.currentPassword);

    if (!matches) {
      throw new UnauthorizedException('That password is not correct.');
    }

    await this.usersService.updatePassword(userId, await this.passwordService.hash(dto.newPassword));

    return this.issueToken({
      id: record.id,
      email: record.email,
      fullName: record.fullName,
      preferredLanguage: record.preferredLanguage,
      role: record.role,
    });
  }

  private async issueToken(user: AuthenticatedUser): Promise<AuthResult> {
    // The role travels in the token for readability, but nothing trusts
    // it: every request re-reads the account, so a promotion or demotion
    // takes effect immediately rather than when the token expires.
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '1h'),
      user,
    };
  }
}
