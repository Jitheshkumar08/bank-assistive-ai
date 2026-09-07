import { describe, expect, it } from 'vitest';
import { GREETING_LANGUAGES, composeGreeting, firstName } from './greeting';

describe('firstName', () => {
  it('takes the first word', () => {
    expect(firstName('Anita Rao Shetty')).toBe('Anita');
  });

  it('handles a single name', () => {
    expect(firstName('Anita')).toBe('Anita');
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(firstName('   Anita    Rao  ')).toBe('Anita');
  });

  it('caps a name too long to be a greeting', () => {
    // Names are typed by customers. One of them will eventually paste a
    // paragraph, and the assistant should not read it out.
    expect(firstName('A'.repeat(200))).toHaveLength(40);
  });
});

describe('composeGreeting', () => {
  const base = { fullName: 'Anita Rao Shetty', branchName: 'Surathkal Branch' };

  it('greets by first name and names the branch', () => {
    const text = composeGreeting({ ...base, language: 'en' });

    expect(text).toContain('Anita');
    expect(text).toContain('Surathkal Branch');
    // The full name would read like a summons rather than a welcome.
    expect(text).not.toContain('Shetty');
  });

  it('speaks Kannada to a Kannada visit', () => {
    const text = composeGreeting({ ...base, language: 'kn' });

    // Kannada script, not a transliteration: the Kannada voice is about
    // to read this aloud.
    expect(text).toMatch(/[ಀ-೿]/);
    expect(text).toContain('Anita');
    expect(text).toContain('Surathkal Branch');
  });

  it('speaks Hindi to a Hindi visit', () => {
    const text = composeGreeting({ ...base, language: 'hi' });

    expect(text).toMatch(/[ऀ-ॿ]/);
    expect(text).toContain('Surathkal Branch');
  });

  it('covers exactly the languages the engine has voices for', () => {
    // A fourth greeting would be words with nothing to say them; a
    // missing one would be a customer greeted in the wrong language.
    expect(GREETING_LANGUAGES.sort()).toEqual(['en', 'hi', 'kn']);
  });

  it('falls back to English rather than saying nothing', () => {
    const text = composeGreeting({ ...base, language: 'ta' });

    // Silence at the moment someone arrives is a broken feature; a
    // greeting in the wrong language is a small annoyance.
    expect(text).toContain('Welcome, Anita');
  });

  it('never leaves a placeholder unfilled', () => {
    for (const language of GREETING_LANGUAGES) {
      const text = composeGreeting({ ...base, language });

      expect(text).not.toMatch(/\{|\}|undefined/);
      expect(text.trim().length).toBeGreaterThan(10);
    }
  });
});
