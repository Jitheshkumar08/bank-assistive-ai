import type {
  AssistantClient,
  AssistantReply,
  AssistantRequest,
  SpeechRequest,
} from '@/types/assistant';

/**
 * Stand-in for the real assistant.
 *
 * It exists so the conversation UI can be built, demonstrated and tested
 * before the Python engine is connected. Everything here is canned text
 * matched on keywords -- there is no intent detection, no retrieval and
 * no workflow state, and none of it should be mistaken for the real
 * thing. The engine owns all of that.
 *
 * Because it implements AssistantClient, replacing it later changes one
 * import and nothing else.
 */

interface CannedResponse {
  /** Matched case-insensitively against the customer's message. */
  triggers: string[];
  reply: string;
}

const RESPONSES: CannedResponse[] = [
  {
    triggers: ['deposit', 'pay in', 'put money'],
    reply:
      'To deposit money, start by taking a deposit slip from the counter. Fill in your account number and the amount, then hand it to the cashier with the cash. Tell me when you have the slip and I will take you through it.',
  },
  {
    triggers: ['withdraw', 'take out', 'cash out'],
    reply:
      'For a withdrawal, take a withdrawal slip from the counter. You will need your account number, the amount, and your signature. Let me know once you have the slip.',
  },
  {
    triggers: ['loan', 'borrow'],
    reply:
      'For a loan application, please go to the loan assistance desk. Bring proof of identity and proof of income. I can explain what documents count if that would help.',
  },
  {
    triggers: ['balance', 'how much'],
    reply:
      'I cannot look up your balance myself. A cashier at the counter can check it for you once you show identification.',
  },
  {
    triggers: ['cheque', 'check book', 'chequebook'],
    reply:
      'A cheque book lets you make payments by writing a cheque instead of using cash. You can request one at the counter, and it usually takes a few working days to arrive.',
  },
  {
    triggers: ['account', 'open'],
    reply:
      'To open an account you will need proof of identity and proof of address. Staff at the main desk can start the application with you.',
  },
  {
    triggers: ['hello', 'hi ', 'hey', 'good morning', 'good afternoon'],
    reply: 'Hello. Tell me what you would like to do today and I will guide you through it.',
  },
  {
    triggers: ['help', 'what can you do'],
    reply:
      'I can guide you through deposits, withdrawals and loan applications, and answer questions about banking services. What would you like to do?',
  },
  {
    triggers: ['thank', 'thanks'],
    reply: 'You are welcome. Is there anything else you would like help with?',
  },
];

const FALLBACK =
  'I am not sure about that one yet. You can ask me about deposits, withdrawals, loan applications or opening an account, and branch staff can help with anything else.';

/** Enough delay that the sending state is visible and worth designing. */
const SIMULATED_LATENCY_MS = 700;

function selectReply(message: string): string {
  const normalized = message.trim().toLowerCase();

  const match = RESPONSES.find((candidate) =>
    candidate.triggers.some((trigger) => normalized.includes(trigger)),
  );

  return match?.reply ?? FALLBACK;
}

export class MockAssistantClient implements AssistantClient {
  // A plain field rather than a constructor parameter property: the
  // project compiles with erasableSyntaxOnly, which forbids syntax that
  // emits runtime code from a type position.
  private readonly latencyMs: number;

  constructor(latencyMs: number = SIMULATED_LATENCY_MS) {
    this.latencyMs = latencyMs;
  }

  async sendMessage(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantReply> {
    await this.delay(signal);

    // Deliberately ignores context and language: the real engine uses
    // both, the mock has nothing useful to do with them. They are still
    // sent so the call site is already correct.
    //
    // It cannot transcribe, so a spoken turn gets a fixed stand-in
    // transcript rather than a pretence of speech recognition.
    if (request.input.type === 'voice') {
      const transcript = 'I want to deposit money';
      return { reply: selectReply(transcript), transcript };
    }

    return { reply: selectReply(request.input.text) };
  }

  /**
   * Produces silence.
   *
   * The mock cannot synthesise speech, so it returns an empty audio Blob
   * rather than pretending. Playback treats that as nothing to play.
   */
  async speak(_request: SpeechRequest, signal?: AbortSignal): Promise<Blob> {
    await this.delay(signal);

    return new Blob([], { type: 'audio/mpeg' });
  }

  /** Resolves after the simulated latency, or rejects if the caller aborts. */
  private delay(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, this.latencyMs);

      function onAbort() {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
