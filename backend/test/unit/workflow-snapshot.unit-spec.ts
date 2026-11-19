import { ForbiddenException, HttpException, Logger, RequestMethod } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AssistantController } from '../../src/assistant/assistant.controller';
import { ActivityService } from '../../src/activity/activity.service';
import { AssistantService } from '../../src/assistant/assistant.service';
import {
  AiEngineClient,
  AiEngineError,
  type EngineSnapshot,
} from '../../src/assistant/engine/ai-engine.client';
import { HttpAiEngineClient } from '../../src/assistant/engine/http-ai-engine.client';
import type { SessionsService } from '../../src/sessions/sessions.service';

/**
 * The assistant now tells an open assisted activity which workflow state
 * the engine reported. Stubbed here: these suites are about the turn
 * itself, and a real one would need a database.
 */
const activityStub = () =>
  ({ followWorkflow: jest.fn().mockResolvedValue(undefined) }) as unknown as ActivityService;


/**
 * P4: the read-only workflow snapshot, NestJS side.
 *
 * No database and no engine: fetch and the sessions service are stubs.
 * These assert that the engine's answer is forwarded without changing its
 * meaning, that only the caller's own visit can be read, and that every
 * failure becomes a clear error rather than invented progress.
 */

const USER = '00000000-0000-0000-0000-0000000000aa';
const SESSION = '00000000-0000-0000-0000-0000000000bb';
const OTHER = '00000000-0000-0000-0000-0000000000cc';

const config = {
  get: (key: string, fallback?: string) =>
    ({ AI_ENGINE_URL: 'http://engine.test', AI_ENGINE_TOKEN: 'secret-token' })[key] ?? fallback,
} as unknown as ConfigService;

const ENGINE_ACTIVE = {
  known: true,
  ended: false,
  workflow: { name: 'deposit money', state: 'active', step: 2, total_steps: 4 },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const client = () => new HttpAiEngineClient(config);

describe('HttpAiEngineClient.getSnapshot', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads the engine with a GET, the internal token and nothing else', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(json(ENGINE_ACTIVE));

    await client().getSnapshot(SESSION);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/sessions/${SESSION}/snapshot`);
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({ 'X-Internal-Token': 'secret-token' });
    expect(init?.body).toBeUndefined();
  });

  it('forwards an active workflow exactly, in this API’s shape', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(ENGINE_ACTIVE));

    await expect(client().getSnapshot(SESSION)).resolves.toEqual({
      known: true,
      ended: false,
      workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
    });
  });

  it('forwards paused and exited states unchanged', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json({
        known: true,
        ended: true,
        workflow: { name: 'withdraw money', state: 'suspended', step: 3, total_steps: 4 },
      }),
    );

    const snapshot = await client().getSnapshot(SESSION);

    expect(snapshot.ended).toBe(true);
    expect(snapshot.workflow).toEqual({
      name: 'withdraw money',
      state: 'suspended',
      step: 3,
      totalSteps: 4,
    });
  });

  it('reports "no workflow" as the engine does, without invented steps', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json({ known: true, ended: false, workflow: { name: null, state: 'none', step: null, total_steps: null } }),
    );

    await expect(client().getSnapshot(SESSION)).resolves.toEqual({
      known: true,
      ended: false,
      workflow: { name: null, state: 'none', step: null, totalSteps: null },
    });
  });

  it('keeps an unknown visit unknown: no workflow, whatever the body contained', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json({ known: false, ended: false, workflow: ENGINE_ACTIVE.workflow }),
    );

    await expect(client().getSnapshot(SESSION)).resolves.toEqual({
      known: false,
      ended: false,
      workflow: null,
    });
  });

  it('maps snapshots and turn replies identically', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(json(ENGINE_ACTIVE))
      .mockResolvedValueOnce(json({ reply: 'ok', ended: false, workflow: ENGINE_ACTIVE.workflow }));

    const snapshot = await client().getSnapshot(SESSION);
    const reply = await client().sendText({ sessionId: SESSION, language: 'en', text: 'hello' });

    expect(snapshot.workflow).toEqual(reply.workflow);
  });

  it('passes a busy engine (409, turn still running) on with its detail', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(json({ detail: 'The assistant is still working on the last request.' }, 409));

    await expect(client().getSnapshot(SESSION)).rejects.toMatchObject({
      status: 409,
      message: 'The assistant is still working on the last request.',
    });
  });

  it('hides an engine failure behind a 502', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json({ detail: 'Traceback …' }, 500));

    await expect(client().getSnapshot(SESSION)).rejects.toMatchObject({
      status: 502,
      message: 'The assistant could not report its progress. Please try again.',
    });
  });

  it.each([
    ['a body with no known flag', json({ ended: false, workflow: null })],
    ['a body that is not JSON', new Response('<html>', { status: 200 })],
  ])('refuses %s rather than guessing', async (_label, response) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response);

    await expect(client().getSnapshot(SESSION)).rejects.toMatchObject({ status: 502 });
  });

  it('reports an unreachable engine as 504', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(client().getSnapshot(SESSION)).rejects.toMatchObject({ status: 504 });
  });

  it('reports a timed-out engine as 504', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));

    await expect(client().getSnapshot(SESSION)).rejects.toMatchObject({
      status: 504,
      message: 'The assistant took too long to answer. Please try again.',
    });
  });
});

describe('AiEngineClient.getSnapshot default', () => {
  it('an engine without snapshot support says so (501) instead of inventing one', async () => {
    class OlderEngine extends AiEngineClient {
      sendText = jest.fn();
      sendAudio = jest.fn();
      synthesize = jest.fn();
      endSession = jest.fn();
    }

    await expect(new OlderEngine().getSnapshot(SESSION)).rejects.toMatchObject({
      name: 'AiEngineError',
      status: 501,
    });
  });
});

describe('AssistantService.snapshot', () => {
  const VIEW: EngineSnapshot = {
    known: true,
    ended: false,
    workflow: { name: 'deposit money', state: 'active', step: 2, totalSteps: 4 },
  };

  function setup(activeId: string | null, getSnapshot: jest.Mock) {
    const sessions = {
      findActive: jest
        .fn()
        .mockResolvedValue(activeId ? { id: activeId, language: 'kn', status: 'ACTIVE' } : null),
    };
    const engine = { getSnapshot } as unknown as AiEngineClient;
    const service = new AssistantService(
      sessions as unknown as SessionsService,
      engine,
      activityStub(),
      config,
    );
    return { service, sessions };
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("returns the engine's view unchanged for the caller's own visit", async () => {
    const getSnapshot = jest.fn().mockResolvedValue(VIEW);
    const { service } = setup(SESSION, getSnapshot);

    await expect(service.snapshot(USER, SESSION)).resolves.toEqual(VIEW);
    expect(getSnapshot).toHaveBeenCalledWith(SESSION);
  });

  it.each([
    ['someone else’s visit', OTHER],
    ['no open visit', null],
  ])('refuses %s and never asks the engine', async (_label, activeId) => {
    const getSnapshot = jest.fn();
    const { service } = setup(activeId, getSnapshot);

    await expect(service.snapshot(USER, SESSION)).rejects.toBeInstanceOf(ForbiddenException);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('turns an engine error into the same HTTP status and message', async () => {
    const getSnapshot = jest
      .fn()
      .mockRejectedValue(new AiEngineError('The assistant is still working on the last request.', 409));
    const { service } = setup(SESSION, getSnapshot);

    const failure = service.snapshot(USER, SESSION);

    await expect(failure).rejects.toBeInstanceOf(HttpException);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      message: 'The assistant is still working on the last request.',
    });
  });

  it('hides anything unexpected behind a 502', async () => {
    const getSnapshot = jest.fn().mockRejectedValue(new Error('boom'));
    const { service } = setup(SESSION, getSnapshot);

    await expect(service.snapshot(USER, SESSION)).rejects.toMatchObject({ status: 502 });
  });
});

describe('AssistantController.snapshot', () => {
  it('is a GET on sessions/:sessionId/snapshot, never cached', () => {
    const handler = AssistantController.prototype.snapshot;

    expect(Reflect.getMetadata('path', handler)).toBe('sessions/:sessionId/snapshot');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('__headers__', handler)).toEqual([
      { name: 'Cache-Control', value: 'no-store' },
    ]);
  });

  it("reads the authenticated customer's visit through the service", async () => {
    const snapshot = jest.fn().mockResolvedValue({ known: false, ended: false, workflow: null });
    const controller = new AssistantController({ snapshot } as unknown as AssistantService);

    await expect(
      controller.snapshot({ id: USER } as never, SESSION),
    ).resolves.toEqual({ known: false, ended: false, workflow: null });
    expect(snapshot).toHaveBeenCalledWith(USER, SESSION);
  });
});
