import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContextService } from '../context/context.service';
import { CreateSessionDto } from './dto/create-session.dto';

export interface SessionView {
  id: string;
  status: SessionStatus;
  language: string;
  startedAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  branch: { id: string; code: string; name: string; city: string | null };
}

/** Shape returned to clients: the branch inlined, ids not exposed twice. */
const SESSION_VIEW = {
  id: true,
  status: true,
  language: true,
  startedAt: true,
  lastActivityAt: true,
  endedAt: true,
  branch: { select: { id: true, code: true, name: true, city: true } },
} as const;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: ContextService,
  ) {}

  /**
   * Establishes branch context for the current visit.
   *
   * Scanning a second code does NOT start a second visit -- it moves the
   * existing one. A customer who scans again, or walks into a different
   * branch, is still on the same visit, and starting fresh would throw
   * away the history that visit represents.
   *
   * This is a single upsert keyed on `activeUserId`, not a read followed
   * by a write. Reading first and then deciding whether to insert leaves
   * a window in which two requests both find nothing and both insert --
   * a double-tapped button on a slow connection is enough to hit it.
   * PostgreSQL resolves the upsert against the unique index in one
   * statement, so the race has nowhere to happen.
   */
  async establish(userId: string, dto: CreateSessionDto): Promise<SessionView> {
    const { branch } = await this.contextService.resolve(dto);

    // The visit inherits the language the account was registered with.
    // Until now this column always fell back to its 'en' default, which
    // was harmless while every reply was English text -- but speech is
    // language-sensitive, and transcribing a Kannada speaker as English
    // fails silently rather than loudly.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLanguage: true },
    });

    return this.prisma.session.upsert({
      where: { activeUserId: userId },
      update: {
        branchId: branch.id,
        lastActivityAt: new Date(),
      },
      create: {
        userId,
        activeUserId: userId,
        branchId: branch.id,
        // Set only on create: a visit's language is decided when the
        // visit starts, so re-scanning mid-visit does not silently
        // change the language mid-conversation.
        language: user?.preferredLanguage ?? 'en',
      },
      select: SESSION_VIEW,
    });
  }

  /** The visit in progress, or null when there is none. */
  async findActive(userId: string): Promise<SessionView | null> {
    return this.prisma.session.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
      orderBy: { startedAt: 'desc' },
      select: SESSION_VIEW,
    });
  }

  /**
   * Ends the visit.
   *
   * This is the only thing that closes a session. Finishing a banking
   * task must never end it -- the customer stays free to start another
   * request, exactly as the assistant engine models it.
   */
  async end(userId: string, sessionId: string): Promise<SessionView> {
    // Scoped by userId so one customer can never end another's session
    // by guessing an id.
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true },
    });

    if (!session) {
      throw new NotFoundException('That session does not exist.');
    }

    if (session.status === SessionStatus.ENDED) {
      return this.prisma.session.findUniqueOrThrow({
        where: { id: session.id },
        select: SESSION_VIEW,
      });
    }

    // Clearing activeUserId is what frees the unique slot, so the next
    // scan can open a fresh visit. Ending a visit and releasing the slot
    // must happen together or not at all.
    return this.prisma.session.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.ENDED,
        endedAt: new Date(),
        activeUserId: null,
      },
      select: SESSION_VIEW,
    });
  }
}
