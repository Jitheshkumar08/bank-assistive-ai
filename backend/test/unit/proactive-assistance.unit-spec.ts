import { ForbiddenException, HttpException, Logger, RequestMethod } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssistantController } from '../../src/assistant/assistant.controller';
import { AssistantService } from '../../src/assistant/assistant.service';
import { AssistanceDto } from '../../src/assistant/dto/assistance.dto';
import {
  AiEngineClient,
  AiEngineError,
  type EngineAssistance,
} from '../../src/assistant/engine/ai-engine.client';
import { HttpAiEngineClient } from '../../src/assistant/engine/http-ai-engine.client';
import type { SessionsService } from '../../src/sessions/sessions.service';

/**
 * Proactive assistance, NestJS side.
 *
 * No database and no engine: fetch and the sessions service are stubs.
 * These assert that the engine's offer is forwarded without changing its
 * meaning, that only the caller's own visit can ask, and that every failure
 * becomes a clear error rather than an invented offer.
 */

const USER = '00000000-0000-0000-0000-0000000000aa';
const SESSION = '00000000-0000-0000-0000-0000000000bb';
const OTHER = '00000000-0000-0000-0000-0000000000cc';

const config = {
  get: (key: string, fallback?: string) =>
    ({ AI_ENGINE_URL: 'http://engine.test', AI_ENGINE_TOKEN: 'secret-token' })[key] ?? fallback,
} as unknown as ConfigService;

const ENGINE_OFFER = {
  offered: true,
  reason: 'offered',
  field: 'account_number',
  prompt_id: 'account_number.1',
  text: 'Take your time. Are you having difficulty entering the account number?',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const client = () => new HttpAiEngineClient(config);

describe('HttpAiEngineClient.requestAssistance', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('POSTs to the engine with the internal token and only the avoid id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(json(ENGINE_OFFER));

    await client().requestAssistance(SESSION, 'account_number.1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/sessions/${SESSION}/assistance`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Internal-Token': 'secret-token',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ avoid: 'account_number.1' });
  });

  it('sends an empty body when there is nothing to avoid', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(json(ENGINE_OFFER));

    await client().requestAssistance(SESSION, null);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({});
  });

  it('forwards an offer exactly, in this API’s shape', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(ENGINE_OFFER));

    await expect(client().requestAssistance(SESSION, null)).resolves.toEqual({
      offered: true,
      reason: 'offered',
      field: 'account_number',
      promptId: 'account_number.1',
      text: ENGINE_OFFER.text,
    });
  });

  it('forwards "no offer" with its reason and no text', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      json({ offered: false, reason: 'pending_question', field: null, prompt_id: null, text: 'stray' }),
    );

    await expect(client().requestAssistance(SESSION, null)).resolves.toEqual({
      offered: false,
      reason: 'pending_question',
      field: null,
      promptId: null,
      text: null,
    });
  });

  it('never reports an offer that has nothing to say', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json({ ...ENGINE_OFFER, text: '   ' }));

    const result = await client().requestAssistance(SESSION, null);

    expect(result.offered).toBe(false);
    expect(result.text).toBeNull();
  });

  it('passes a busy engine (409) on with its detail', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(json({ detail: 'The assistant is still working on the last request.' }, 409));

    await expect(client().requestAssistance(SESSION, null)).rejects.toMatchObject({
      status: 409,
      message: 'The assistant is still working on the last request.',
    });
  });

  it('hides an engine failure behind a 502', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json({ detail: 'Traceback …' }, 500));

    await expect(client().requestAssistance(SESSION, null)).rejects.toMatchObject({
      status: 502,
      message: 'The assistant could not offer help right now.',
    });
  });

  it.each([
    ['a body with no offered flag', json({ reason: 'offered', text: 'hi' })],
    ['a body that is not JSON', new Response('<html>', { status: 200 })],
  ])('refuses %s rather than guessing', async (_label, response) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response);

    await expect(client().requestAssistance(SESSION, null)).rejects.toMatchObject({ status: 502 });
  });

  it('reports an unreachable engine as 504', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(client().requestAssistance(SESSION, null)).rejects.toMatchObject({ status: 504 });
  });
});

describe('AiEngineClient.requestAssistance default', () => {
  it('an engine without it says so (501) instead of inventing an offer', async () => {
    class OlderEngine extends AiEngineClient {
      sendText = jest.fn();
      sendAudio = jest.fn();
      synthesize = jest.fn();
      endSession = jest.fn();
    }

    await expect(new OlderEngine().requestAssistance(SESSION, null)).rejects.toMatchObject({
      name: 'AiEngineError',
      status: 501,
    });
  });
});

describe('AssistantService.assistance', () => {
  const OFFER: EngineAssistance = {
    offered: true,
    reason: 'offered',
    field: 'amount',
    promptId: 'amount.1',
    text: 'Would you like me to explain how to enter the amount?',
  };

  function setup(activeId: string | null, requestAssistance: jest.Mock) {
    const sessions = {
      findActive: jest
        .fn()
        .mockResolvedValue(activeId ? { id: activeId, language: 'kn', status: 'ACTIVE' } : null),
    };
    const engine = { requestAssistance } as unknown as AiEngineClient;
    return new AssistantService(sessions as unknown as SessionsService, engine, config);
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("returns the engine's offer unchanged for the caller's own visit", async () => {
    const requestAssistance = jest.fn().mockResolvedValue(OFFER);
    const service = setup(SESSION, requestAssistance);

    await expect(service.assistance(USER, SESSION, 'amount.2')).resolves.toEqual(OFFER);
    expect(requestAssistance).toHaveBeenCalledWith(SESSION, 'amount.2');
  });

  it.each([
    ['someone else’s visit', OTHER],
    ['no open visit', null],
  ])('refuses %s and never asks the engine', async (_label, activeId) => {
    const requestAssistance = jest.fn();
    const service = setup(activeId, requestAssistance);

    await expect(service.assistance(USER, SESSION, null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(requestAssistance).not.toHaveBeenCalled();
  });

  it('turns an engine error into the same HTTP status and message', async () => {
    const requestAssistance = jest
      .fn()
      .mockRejectedValue(new AiEngineError('The assistant is still working on the last request.', 409));
    const failure = setup(SESSION, requestAssistance).assistance(USER, SESSION, null);

    await expect(failure).rejects.toBeInstanceOf(HttpException);
    await expect(failure).rejects.toMatchObject({ status: 409 });
  });

  it('hides anything unexpected behind a 502', async () => {
    const service = setup(SESSION, jest.fn().mockRejectedValue(new Error('boom')));

    await expect(service.assistance(USER, SESSION, null)).rejects.toMatchObject({ status: 502 });
  });
});

describe('AssistantController.assistance', () => {
  it('is a POST on sessions/:sessionId/assistance, never cached', () => {
    const handler = AssistantController.prototype.assistance;

    expect(Reflect.getMetadata('path', handler)).toBe('sessions/:sessionId/assistance');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('__headers__', handler)).toEqual([
      { name: 'Cache-Control', value: 'no-store' },
    ]);
  });

  it("asks on behalf of the authenticated customer's visit", async () => {
    const assistance = jest.fn().mockResolvedValue({ offered: false, reason: 'paused' });
    const controller = new AssistantController({ assistance } as unknown as AssistantService);

    await controller.assistance({ id: USER } as never, SESSION, { avoid: 'general.1' });
    await controller.assistance({ id: USER } as never, SESSION, {});

    expect(assistance).toHaveBeenNthCalledWith(1, USER, SESSION, 'general.1');
    expect(assistance).toHaveBeenNthCalledWith(2, USER, SESSION, null);
  });
});

describe('AssistanceDto', () => {
  it.each([[{}], [{ avoid: 'account_number.2' }]])('accepts %j', async (body) => {
    await expect(validate(plainToInstance(AssistanceDto, body))).resolves.toHaveLength(0);
  });

  it.each([[{ avoid: '../etc' }], [{ avoid: 'x'.repeat(80) }], [{ avoid: 3 }]])(
    'refuses %j',
    async (body) => {
      const errors = await validate(plainToInstance(AssistanceDto, body));
      expect(errors.length).toBeGreaterThan(0);
    },
  );
});
