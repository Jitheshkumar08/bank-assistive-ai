import type { HistoryProvenance, Suggestion } from '@/types/suggestions';

/**
 * Everything the remembered-payment cards say, in all three languages.
 *
 * The language keys match the engine's voices exactly, as
 * `lib/greeting.ts` does, so the words and the voice reading them can
 * never disagree.
 *
 * TWO RULES HOLD THIS FILE TOGETHER.
 *
 * Nothing spoken contains a figure. Not an amount, not an account
 * number, not a date as digits. A customer stands at a counter with
 * strangers beside them and the phone's speaker on; "around this date"
 * is as specific as speech is allowed to get. Amounts belong on screen,
 * where only the person holding the phone can read them.
 *
 * Demonstration history is labelled as such. A seeded record is not
 * something the bank said, so the card carries a badge and the spoken
 * line carries a marker -- once per greeting, not once per card.
 */

type Language = 'en' | 'kn' | 'hi';

const FALLBACK: Language = 'en';

function resolve(language: string): Language {
  return language === 'kn' || language === 'hi' ? language : FALLBACK;
}

interface CardCopy {
  heading: string;
  demoBadge: string;
  demoExplainer: string;
  lastPaymentTitle: string;
  recurringTitle: string;
  payeeLine: (name: string) => string;
  recurringLine: (name: string, day: string) => string;
  continueLabel: string;
  declineLabel: string;
  askAnything: string;
  /** Review screen */
  reviewTitle: string;
  reviewIntro: string;
  reviewPayee: string;
  reviewAmount: string;
  reviewAccount: string;
  reviewNotice: string;
  reviewConfirm: string;
  reviewConfirming: string;
  reviewBack: string;
}

const CARDS: Record<Language, CardCopy> = {
  en: {
    heading: 'Carry on where you left off',
    demoBadge: 'Demo history',
    demoExplainer: 'Based on demonstration records, not bank statements.',
    lastPaymentTitle: 'Your last payment',
    recurringTitle: 'Your regular payment',
    payeeLine: (name) => `Payment to ${name}`,
    recurringLine: (name, day) => `Usually paid to ${name} around the ${day}`,
    continueLabel: 'Continue',
    declineLabel: 'Not now',
    askAnything: 'Or ask me anything else',
    reviewTitle: 'Check these details',
    reviewIntro: 'Nothing happens until you confirm.',
    reviewPayee: 'Paying',
    reviewAmount: 'Amount',
    reviewAccount: 'Account',
    reviewNotice:
      'This assistant guides you through your payment at the branch. It does not move money itself.',
    reviewConfirm: 'Yes, continue',
    reviewConfirming: 'Opening the assistant',
    reviewBack: 'Go back',
  },
  kn: {
    heading: 'ನಿಲ್ಲಿಸಿದ ಕಡೆಯಿಂದ ಮುಂದುವರಿಸಿ',
    demoBadge: 'ಡೆಮೋ ದಾಖಲೆ',
    demoExplainer: 'ಇದು ಪ್ರದರ್ಶನದ ದಾಖಲೆಗಳ ಆಧಾರದ ಮೇಲೆ, ಬ್ಯಾಂಕ್ ಹೇಳಿಕೆಯಲ್ಲ.',
    lastPaymentTitle: 'ನಿಮ್ಮ ಕೊನೆಯ ಪಾವತಿ',
    recurringTitle: 'ನಿಮ್ಮ ನಿಯಮಿತ ಪಾವತಿ',
    payeeLine: (name) => `${name} ಅವರಿಗೆ ಪಾವತಿ`,
    recurringLine: (name, day) => `ಸಾಮಾನ್ಯವಾಗಿ ${day} ರ ಸುಮಾರಿಗೆ ${name} ಅವರಿಗೆ ಪಾವತಿ`,
    continueLabel: 'ಮುಂದುವರಿಸಿ',
    declineLabel: 'ಈಗ ಬೇಡ',
    askAnything: 'ಅಥವಾ ಬೇರೆ ಏನಾದರೂ ಕೇಳಿ',
    reviewTitle: 'ಈ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ',
    reviewIntro: 'ನೀವು ದೃಢಪಡಿಸುವವರೆಗೆ ಏನೂ ಆಗುವುದಿಲ್ಲ.',
    reviewPayee: 'ಪಾವತಿ ಯಾರಿಗೆ',
    reviewAmount: 'ಮೊತ್ತ',
    reviewAccount: 'ಖಾತೆ',
    reviewNotice:
      'ಈ ಸಹಾಯಕ ಶಾಖೆಯಲ್ಲಿ ನಿಮ್ಮ ಪಾವತಿಗೆ ಮಾರ್ಗದರ್ಶನ ನೀಡುತ್ತದೆ. ಅದು ಸ್ವತಃ ಹಣ ವರ್ಗಾಯಿಸುವುದಿಲ್ಲ.',
    reviewConfirm: 'ಹೌದು, ಮುಂದುವರಿಸಿ',
    reviewConfirming: 'ಸಹಾಯಕವನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ',
    reviewBack: 'ಹಿಂದೆ ಹೋಗಿ',
  },
  hi: {
    heading: 'जहाँ छोड़ा था वहीं से जारी रखें',
    demoBadge: 'डेमो रिकॉर्ड',
    demoExplainer: 'यह प्रदर्शन के रिकॉर्ड पर आधारित है, बैंक विवरण नहीं।',
    lastPaymentTitle: 'आपका पिछला भुगतान',
    recurringTitle: 'आपका नियमित भुगतान',
    payeeLine: (name) => `${name} को भुगतान`,
    recurringLine: (name, day) => `आमतौर पर ${day} के आसपास ${name} को भुगतान`,
    continueLabel: 'जारी रखें',
    declineLabel: 'अभी नहीं',
    askAnything: 'या मुझसे कुछ और पूछें',
    reviewTitle: 'ये विवरण जाँच लें',
    reviewIntro: 'आपकी पुष्टि के बिना कुछ नहीं होगा।',
    reviewPayee: 'भुगतान किसे',
    reviewAmount: 'राशि',
    reviewAccount: 'खाता',
    reviewNotice:
      'यह सहायक शाखा में आपके भुगतान के लिए मार्गदर्शन देती है। यह स्वयं पैसे नहीं भेजती।',
    reviewConfirm: 'हाँ, जारी रखें',
    reviewConfirming: 'सहायक खोली जा रही है',
    reviewBack: 'वापस जाएँ',
  },
};

export function suggestionCopy(language: string): CardCopy {
  return CARDS[resolve(language)];
}

// --- Spoken wording -------------------------------------------------

interface SpokenCopy {
  demoMarker: string;
  lastPayment: (name: string) => string;
  recurring: (name: string) => string;
  askAnything: string;
}

const SPOKEN: Record<Language, SpokenCopy> = {
  en: {
    demoMarker: 'From your demo history:',
    lastPayment: (name) => `your last payment was to ${name}. Shall I set that up again?`,
    recurring: (name) => `you usually pay ${name} around this date. Shall I set that up?`,
    askAnything: 'Or ask me anything else.',
  },
  kn: {
    demoMarker: 'ನಿಮ್ಮ ಡೆಮೋ ದಾಖಲೆಯಿಂದ:',
    lastPayment: (name) => `ನಿಮ್ಮ ಕೊನೆಯ ಪಾವತಿ ${name} ಅವರಿಗೆ ಆಗಿತ್ತು. ಅದನ್ನೇ ಮತ್ತೆ ಸಿದ್ಧಪಡಿಸಲೇ?`,
    recurring: (name) =>
      `ನೀವು ಸಾಮಾನ್ಯವಾಗಿ ಈ ದಿನಾಂಕದ ಸುಮಾರಿಗೆ ${name} ಅವರಿಗೆ ಪಾವತಿಸುತ್ತೀರಿ. ಅದನ್ನು ಸಿದ್ಧಪಡಿಸಲೇ?`,
    askAnything: 'ಅಥವಾ ಬೇರೆ ಏನಾದರೂ ಕೇಳಿ.',
  },
  hi: {
    demoMarker: 'आपके डेमो रिकॉर्ड से:',
    lastPayment: (name) => `आपका पिछला भुगतान ${name} को था. क्या वही फिर तैयार करूँ?`,
    recurring: (name) => `आप आमतौर पर इसी तारीख के आसपास ${name} को भुगतान करते हैं. वही तैयार करूँ?`,
    askAnything: 'या मुझसे कुछ और पूछें.',
  },
};

/**
 * The sentence spoken after the welcome, as one continuous utterance.
 *
 * Returns null when there is nothing to offer, so the greeting is
 * spoken exactly as it is today.
 *
 * The demonstration marker appears once, at the front, however many
 * cards there are: repeating it per card turns an honest label into
 * noise someone learns to ignore.
 */
export function composeSuggestionSpeech(options: {
  language: string;
  suggestions: readonly Suggestion[];
}): string | null {
  const { suggestions } = options;

  if (suggestions.length === 0) return null;

  const copy = SPOKEN[resolve(options.language)];

  const clauses = suggestions.map((suggestion) =>
    suggestion.type === 'RECURRING_TODAY'
      ? copy.recurring(suggestion.payee.displayName)
      : copy.lastPayment(suggestion.payee.displayName),
  );

  const needsMarker = suggestions.some((suggestion) => !isBankVerified(suggestion.provenance));
  const opening = needsMarker ? copy.demoMarker + ' ' : '';

  return [opening + clauses.join(' '), copy.askAnything].join(' ').trim();
}

/** The closing sentence: there is always a way out of a spoken menu. */
export function spokenWayOut(language: string): string {
  return SPOKEN[resolve(language)].askAnything;
}

export function isBankVerified(provenance: HistoryProvenance): boolean {
  return provenance === 'BANK_VERIFIED';
}

// --- Figures, for the screen only -----------------------------------

const LOCALES: Record<Language, string> = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN' };

/** Minor units to something a customer recognises. Screen only. */
export function formatAmount(amountMinor: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(LOCALES[resolve(language)], {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amountMinor / 100);
  } catch {
    // An unknown currency code must not blank the card.
    return `${currency} ${Math.round(amountMinor / 100)}`;
  }
}

/** "16th", in the reader's language. Screen only -- never spoken. */
export function formatDayOfMonth(day: number, language: string): string {
  const resolved = resolve(language);

  if (resolved !== 'en') return String(day);

  const remainder = day % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? 'th'
      : ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';

  return `${day}${remainder >= 11 && remainder <= 13 ? 'th' : suffix}`;
}
