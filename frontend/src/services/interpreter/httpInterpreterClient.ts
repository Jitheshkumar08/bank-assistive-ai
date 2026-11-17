import { api } from '@/api/client';
import type { InterpreterClient, InterpreterLanguage } from '@/types/interpreter';

/** Recognition or translation plus a network hop: the assistant's budget. */
const INTERPRETER_TIMEOUT_MS = 60_000;

function extensionFor(mimeType: string): string {
  const type = (mimeType || '').toLowerCase();

  if (type.includes('webm')) return '.webm';
  if (type.includes('ogg')) return '.ogg';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return '.m4a';
  if (type.includes('mpeg')) return '.mp3';
  if (type.includes('wav')) return '.wav';

  return '.webm';
}

/**
 * The interpreter, reached through the Node API like the assistant.
 *
 * Separate routes from the assistant's on purpose: none of them sends a
 * conversation turn, so nothing said through the interpreter can be routed
 * as a banking request.
 */
export class HttpInterpreterClient implements InterpreterClient {
  async languages(signal?: AbortSignal): Promise<InterpreterLanguage[]> {
    return api.get<InterpreterLanguage[]>('/assistant/interpreter/languages', signal);
  }

  async transcribe(
    request: { sessionId: string; language: string; audio: Blob; mimeType: string },
    signal?: AbortSignal,
  ): Promise<{ text: string; language: string }> {
    const form = new FormData();

    form.append('sessionId', request.sessionId);
    form.append('language', request.language);
    form.append('audio', request.audio, `utterance${extensionFor(request.mimeType)}`);

    return api.postSlow('/assistant/interpreter/transcribe', form, INTERPRETER_TIMEOUT_MS, signal);
  }

  async translate(
    request: { sessionId: string; text: string; sourceLanguage: string; targetLanguage: string },
    signal?: AbortSignal,
  ): Promise<{ translation: string }> {
    return api.postSlow('/assistant/interpreter/translate', request, INTERPRETER_TIMEOUT_MS, signal);
  }

  async speak(
    request: { sessionId: string; text: string; language: string },
    signal?: AbortSignal,
  ): Promise<Blob> {
    return api.postForBlob('/assistant/interpreter/speak', request, INTERPRETER_TIMEOUT_MS, signal);
  }
}
