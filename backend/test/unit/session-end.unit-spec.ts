import { Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SessionStatus } from '@prisma/client';
import { AiEngineClient, AiEngineError } from '../../src/assistant/engine/ai-engine.client';
import { HttpAiEngineClient } from '../../src/assistant/engine/http-ai-engine.client';
import type { ContextService } from '../../src/context/context.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { SessionsService } from '../../src/sessions/sessions.service';

/**
 * G4: ending a visit releases the engine's conversation.
 *
 * No database: Prisma is a stub, so these assert the ORDER and the
 * failure handling, which is what the lifecycle depends on.
 */

const USER = '00000000-0000-0000-0000-0000000000aa';
const SESSION = '00000000-0000-0000-0000-0000000000bb';

function setup(status: SessionStatus | null) {
  const order: string[] = [];
  const view = { id: SESSION, status: SessionStatus.ENDED };

  const prisma = {
    session: {
      findFirst: jest.fn().mockResolvedValue(status ? { id: SESSION, status } : null),
      update: jest.fn(async () => {
        order.push('db:update');
        return view;
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(view),
    },
  };

  const engine = {
    endSession: jest.fn(async () => {
      order.push('engine:end');
    }),
  };

  const service = new SessionsService(
    prisma as unknown as PrismaService,
    {} as ContextService,
    engine as unknown as AiEngineClient,
  );

  return { service, prisma, engine, order };
}

describe('SessionsService.end', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('ends the visit in the database, then releases the engine conversation', async () => {
    const { service, prisma, engine, order } = setup(SessionStatus.ACTIVE);

    const result = await service.end(USER, SESSION);

    expect(result.status).toBe(SessionStatus.ENDED);
    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SESSION },
        data: expect.objectContaining({ status: SessionStatus.ENDED, activeUserId: null }),
      }),
    );
    expect(engine.endSession).toHaveBeenCalledWith(SESSION);
    expect(order).toEqual(['db:update', 'engine:end']);
  });

  it('still ends the visit when the engine cannot be told', async () => {
    const { service, prisma, engine } = setup(SessionStatus.ACTIVE);
    engine.endSession.mockRejectedValueOnce(new AiEngineError('down', 504));

    await expect(service.end(USER, SESSION)).resolves.toMatchObject({
      status: SessionStatus.ENDED,
    });
    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('does not tell the engine anything when the database update fails', async () => {
    const { service, prisma, engine } = setup(SessionStatus.ACTIVE);
    prisma.session.update.mockRejectedValueOnce(new Error('database down'));

    await expect(service.end(USER, SESSION)).rejects.toThrow('database down');
    expect(engine.endSession).not.toHaveBeenCalled();
  });

  it('ending twice is safe and retries the engine release', async () => {
    const { service, prisma, engine } = setup(SessionStatus.ENDED);

    await expect(service.end(USER, SESSION)).resolves.toMatchObject({
      status: SessionStatus.ENDED,
    });

    // Already ended: the row is not written again...
    expect(prisma.session.update).not.toHaveBeenCalled();
    // ...but a release the engine missed the first time gets another go.
    expect(engine.endSession).toHaveBeenCalledWith(SESSION);
  });

  it('a repeated end survives an engine failure too', async () => {
    const { service, engine } = setup(SessionStatus.ENDED);
    engine.endSession.mockRejectedValueOnce(new Error('down'));

    await expect(service.end(USER, SESSION)).resolves.toMatchObject({
      status: SessionStatus.ENDED,
    });
  });

  it("never releases a session that is not the caller's", async () => {
    const { service, engine } = setup(null);

    await expect(service.end(USER, SESSION)).rejects.toBeInstanceOf(NotFoundException);
    expect(engine.endSession).not.toHaveBeenCalled();
  });
});

describe('HttpAiEngineClient.endSession', () => {
  const config = {
    get: (key: string, fallback?: string) =>
      ({ AI_ENGINE_URL: 'http://engine.test', AI_ENGINE_TOKEN: 'secret-token' })[key] ?? fallback,
  } as unknown as ConfigService;

  afterEach(() => jest.restoreAllMocks());

  it("accepts the engine's { removed } answer as success", async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ removed: true }), { status: 200 }));

    await expect(new HttpAiEngineClient(config).endSession(SESSION)).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/sessions/${SESSION}`);
    expect(init?.method).toBe('DELETE');
    expect(init?.headers).toEqual({ 'X-Internal-Token': 'secret-token' });
  });

  it('treats a conversation the engine no longer has as success', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ removed: false }), { status: 200 }));

    await expect(new HttpAiEngineClient(config).endSession(SESSION)).resolves.toBeUndefined();
  });

  it('rejects when the engine refuses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));

    await expect(new HttpAiEngineClient(config).endSession(SESSION)).rejects.toBeInstanceOf(
      AiEngineError,
    );
  });

  it('rejects when the engine is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(new HttpAiEngineClient(config).endSession(SESSION)).rejects.toBeInstanceOf(
      AiEngineError,
    );
  });
});
