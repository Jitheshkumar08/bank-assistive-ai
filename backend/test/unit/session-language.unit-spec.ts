import type { ConfigService } from '@nestjs/config';
import { SessionStatus } from '@prisma/client';
import { AssistantService } from '../../src/assistant/assistant.service';
import type { AiEngineClient } from '../../src/assistant/engine/ai-engine.client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SessionsService } from '../../src/sessions/sessions.service';
import { UsersService } from '../../src/users/users.service';

/**
 * M2: the visit's language is the single source of truth.
 *
 * NestJS owns the visit, so it decides the language every engine call
 * carries: typed turns, spoken turns and speech synthesis. These assert
 * that all three read it from the visit on every request -- so a change
 * reaches the next call of each kind together -- and that a customer's
 * language change moves their open visit with it.
 *
 * No database: Prisma and the sessions service are stubs.
 */

const USER = '00000000-0000-0000-0000-0000000000aa';
const SESSION = '00000000-0000-0000-0000-0000000000bb';

const AUDIO = {
  buffer: Buffer.from('not-really-audio'),
  mimetype: 'audio/webm',
  size: 16,
};

function setupAssistant(initialLanguage: string) {
  const visit = { id: SESSION, language: initialLanguage };

  const sessions = {
    // Re-read on every request, exactly like the real findActive().
    findActive: jest.fn(async () => ({ ...visit })),
  };

  type Turn = { sessionId: string; language: string };

  const reply = { reply: 'ok', workflow: null, ended: false };
  const engine = {
    sendText: jest.fn(async (_turn: Turn) => reply),
    sendAudio: jest.fn(async (_turn: Turn) => ({ ...reply, transcript: 'heard' })),
    synthesize: jest.fn(async (_request: { text: string; language: string }) => ({
      audio: Buffer.from('ID3'),
      contentType: 'audio/mpeg',
    })),
  };

  const config = { get: (_key: string, fallback?: string) => fallback } as unknown as ConfigService;

  const service = new AssistantService(
    sessions as unknown as SessionsService,
    engine as unknown as AiEngineClient,
    config,
  );

  /** The language each engine call carried, in call order. */
  const sent = () => ({
    text: engine.sendText.mock.calls.map(([turn]) => turn.language),
    audio: engine.sendAudio.mock.calls.map(([turn]) => turn.language),
    speech: engine.synthesize.mock.calls.map(([request]) => request.language),
  });

  const changeLanguage = (language: string) => {
    visit.language = language;
  };

  return { service, engine, sent, changeLanguage };
}

async function oneOfEach(service: AssistantService) {
  await service.sendText(USER, SESSION, 'hello');
  await service.sendVoice(USER, SESSION, AUDIO);
  await service.speak(USER, SESSION, 'reply');
}

describe('AssistantService: one language per visit', () => {
  it('sends the visit language with text, voice and speech alike', async () => {
    const { service, sent } = setupAssistant('kn');

    await oneOfEach(service);

    expect(sent()).toEqual({ text: ['kn'], audio: ['kn'], speech: ['kn'] });
  });

  it('follows an English to Kannada change on the very next call of every kind', async () => {
    const { service, sent, changeLanguage } = setupAssistant('en');

    await oneOfEach(service);
    changeLanguage('kn');
    await oneOfEach(service);

    expect(sent()).toEqual({
      text: ['en', 'kn'],
      audio: ['en', 'kn'],
      speech: ['en', 'kn'],
    });
  });

  it('follows a Kannada to Hindi change', async () => {
    const { service, sent, changeLanguage } = setupAssistant('kn');

    await oneOfEach(service);
    changeLanguage('hi');
    await oneOfEach(service);

    expect(sent()).toEqual({
      text: ['kn', 'hi'],
      audio: ['kn', 'hi'],
      speech: ['kn', 'hi'],
    });
  });

  it('keeps sending the same language when nothing changes', async () => {
    const { service, sent } = setupAssistant('hi');

    await oneOfEach(service);
    await oneOfEach(service);
    await oneOfEach(service);

    expect(sent()).toEqual({
      text: ['hi', 'hi', 'hi'],
      audio: ['hi', 'hi', 'hi'],
      speech: ['hi', 'hi', 'hi'],
    });
  });

  it('always targets the same visit, so the engine keeps one conversation', async () => {
    const { service, engine, changeLanguage } = setupAssistant('en');

    await service.sendText(USER, SESSION, 'hello');
    changeLanguage('kn');
    await service.sendText(USER, SESSION, 'hello');

    const ids = engine.sendText.mock.calls.map(([turn]) => turn.sessionId);
    expect(ids).toEqual([SESSION, SESSION]);
  });
});

describe('UsersService.updateProfile: the open visit moves with the account', () => {
  function setupUsers() {
    const user = { id: USER, email: 'a@b.test', fullName: 'A', preferredLanguage: 'kn', role: 'CUSTOMER' };

    const prisma = {
      user: { update: jest.fn(() => 'user-update') },
      session: { updateMany: jest.fn(() => 'session-update') },
      $transaction: jest.fn(async (operations: unknown[]) => {
        expect(operations).toEqual(['user-update', 'session-update']);
        return [user, { count: 1 }];
      }),
    };

    return { service: new UsersService(prisma as unknown as PrismaService), prisma };
  }

  it('updates the active visit language in the same transaction', async () => {
    const { service, prisma } = setupUsers();

    await service.updateProfile(USER, { preferredLanguage: 'kn' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, status: SessionStatus.ACTIVE },
      data: { language: 'kn' },
    });
  });

  it('leaves the visit untouched when the language is not being changed', async () => {
    const { service, prisma } = setupUsers();

    await service.updateProfile(USER, { fullName: 'New Name' });

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, status: SessionStatus.ACTIVE },
      data: {},
    });
  });
});
