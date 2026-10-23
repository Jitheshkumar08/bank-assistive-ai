"""Lexical service evidence for intent detection (M4).

WHY THE EMBEDDINGS ALONE ARE NOT ENOUGH

Measured before M4 on this project's model (paraphrase-multilingual-
MiniLM-L12-v2): for Kannada, similarity is driven by the sentence FRAME far
more than by the word naming the service.

    "ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಸಾಲ ಬೇಕು" (I need an education LOAN)
        best example: "ನಾನು ಹಣ ಜಮಾ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ" (DEPOSIT)  0.819
    "ನನಗೆ cash withdraw ಮಾಡಬೇಕು"   -> deposit
    "ನನಗೆ cash deposit ಮಾಡಬೇಕು"    -> withdraw

English words inside a Kannada sentence barely move the vector, so "cash
withdraw" and "cash deposit" are nearly the same point. More examples narrow
the gap but cannot close it for phrasings nobody wrote an example for.

WHAT THIS MODULE DOES

It finds the words that name a service unambiguously, in any script, and
returns the set of services they name. IntentDetector then chooses ONLY
among those services and applies its existing margin test to that choice.

That gives the one safety property this layer is allowed to have: it can
NARROW the detector's choice or turn it into an abstention, never widen it.
The restricted best score can never exceed the unrestricted one, so a
sentence the detector would not call a banking request can never become one
here, and no service is ever chosen without the embeddings agreeing it is a
banking request.

WHAT COUNTS AS EVIDENCE

Whole words, matched by prefix so inflection does not matter (ಸಾಲಕ್ಕೆ,
निकालने, deposits). Words that name more than one service are not evidence
on their own:

  ತೆಗೆ ("take out" / "open") is a WITHDRAWAL only beside a money word
  (ಹಣ ತೆಗೆ), an ACCOUNT OPENING only beside an account word with no money
  word (ಖಾತೆ ತೆಗೆ). The 3.2B-15 audit recorded this exact collision.

  An account word alone ("ಖಾತೆಗೆ ಹಣ ಹಾಕಬೇಕು", put money INTO the account)
  is not account opening; it needs an opening verb or "new" beside it.

Ordinary words, not a classifier: nothing here is trained, and every entry
is a word a bank customer uses to name the service.

LOANWORDS (M5)

Evidence is read from the canonical routing form, where every banking
loanword is already written in English (text_normalization: ಲೋನ್ / लोन ->
loan, एकाउंट -> account, ಕ್ಯಾಶ್ -> cash, "balence" -> balance). So the lists
below hold only native words and the English forms; the scripts and
misspellings of a loanword live in one table, not here as well.

SERVICE PHRASING (M10)

M10 made a named service a precondition for starting a workflow (see
detector.py, "THE M10 START RULE"). People do not always name the service,
so evidence also comes from how the request is PHRASED, by combinations of
ordinary words:

  balance   a quantity, "remaining", "enough" or yes/no question about money
            in one's own account: "ನನ್ನ ಖಾತೆಯಲ್ಲಿ ಎಷ್ಟು ದುಡ್ಡು ಉಳಿದಿದೆ",
            "मेरे खाते में कितना पैसा बचा है", "do I have 5000 in my account"
  deposit   a put-in verb with money or an amount: "ಖಾತೆಗೆ ದುಡ್ಡು ಹಾಕ್ಬೇಕು",
            "खाते में पैसे डालने हैं", "put some cash into my account"
  withdraw  a take-out verb with money or an amount: "ಐದು ಸಾವಿರ ಬಿಡಿಸಿಕೊಳ್ಳಬೇಕು",
            "take some cash out of my account"

The balance frame counts only when nothing else is named, so "how much can
I withdraw" stays a withdrawal and "पैसे जमा करने हैं" a deposit. A money
word or an amount is always required: "ಅರ್ಜಿ ಹಾಕಿ" (put in an application)
and "ಮನೆ ಕಟ್ಟೋಕೆ ಸಾಲ" (a loan to BUILD a house) are not deposits.
"""

from app.dialogue.indic_numbers import extract_amount
from app.dialogue.multilingual_phrases import fold, word_tokens
from app.dialogue.text_normalization import canonicalize_loanwords

DEPOSIT = "deposit money"
WITHDRAW = "withdraw money"
BALANCE = "check account balance"
LOAN = "apply for loan"
OPEN_ACCOUNT = "open new account"

#: Words that name exactly one service, matched by prefix.
SERVICE_WORD_PREFIXES = {
    DEPOSIT: ("deposit", "ಜಮಾ", "जमा", "jama"),
    WITHDRAW: ("withdraw", "निकाल", "निकलवा", "nikal", "nikaal", "ಹಿಂಪಡೆ"),
    LOAN: ("loan", "ऋण", "कर्ज", "karz", "karj"),
    BALANCE: ("balance", "ಶಿಲ್ಕು", "शेष", "shesh"),
}

#: Compounds ending in a loan word: होमलोन, homeloan (M10).
LOAN_SUFFIXES = ("loan", "लोन", "ಲೋನ್")

#: ಸಾಲ (loan) by exact form: its prefix also begins ಸಾಲು (a queue, a row).
KANNADA_LOAN_WORDS = {"ಸಾಲ", "ಸಾಲದ", "ಸಾಲಕ್ಕೆ", "ಸಾಲಕ್ಕಾಗಿ", "ಸಾಲವನ್ನು", "ಸಾಲವು", "ಸಾಲಗಳು", "ಸಾಲದಲ್ಲಿ"}

#: Account opening needs an account word AND an opening verb or "new".
ACCOUNT_PREFIXES = ("account", "ಖಾತೆ", "ಅಕೌಂಟ", "खात", "khata", "khaat", "khate")
OPEN_PREFIXES = ("open", "ಓಪನ್", "ತೆರೆ", "खोल", "खुल", "khol", "khul", "tere")
NEW_WORDS = {"new", "ಹೊಸ", "नया", "नई", "नए", "naya", "nayi", "naye", "hosa"}

#: ತೆಗೆ, disambiguated by what is beside it.
TAKE_OUT_PREFIXES = ("ತೆಗೆ", "tege", "tegi")
MONEY_PREFIXES = ("ಹಣ", "ದುಡ್ಡು", "ನಗದು", "cash", "hana", "duddu",
                  # M10: Hindi and English money words, and the currency
                  "पैस", "रकम", "राशि", "नकद", "paise", "paisa", "rakam", "money",
                  "ರೂಪಾಯ", "रुपय", "रुपए", "रुपये", "rupee", "rupay",
                  # romanised scale words: an amount the number parser does not read
                  "hazaar", "hazar", "hajar", "saavir", "savir", "lakh")

# --- service phrasing (M10) -------------------------------------------------

POSSESSIVE_WORDS = {"my", "ನನ್ನ", "ನನ್", "मेरा", "मेरे", "मेरी", "अपना", "अपने", "अपनी",
                    "mera", "mere", "meri", "apna", "apne", "nanna"}
HOW_MUCH_WORDS = {"ಎಷ್ಟು", "ಎಷ್ಟಿದೆ", "कितना", "कितने", "कितनी", "kitna", "kitne", "kitni", "eshtu", "eshtide"}
#: "remaining" by prefix; बचा / बचे by exact form (बचत is "savings").
REMAINING_PREFIXES = ("ಉಳಿದ", "left", "remaining", "बाकी", "baaki", "baki", "ulid")
REMAINING_WORDS = {"बचा", "बचे", "बची", "bacha", "bache", "bachi"}
ENOUGH_PREFIXES = ("enough", "sufficient", "पर्याप्त", "ಸಾಕಷ್ಟು", "paryapt")
#: Kannada yes/no "is there?" endings, on any word (ದುಡ್ಡಿದೆಯಾ, ಇರುತ್ತಾ).
KANNADA_EXISTENCE_ENDINGS = ("ಇದೆಯಾ", "ಇದೆಯೇ", "ಇದ್ಯಾ", "ವಿದೆಯಾ", "ದಿದೆಯಾ", "ಇರುತ್ತಾ", "ಇರತ್ತಾ")
HINDI_YES_NO_OPENERS = {"क्या", "kya"}
HINDI_EXISTENCE_ENDINGS = {"है", "हैं", "hai", "hain"}

PUT_IN_PREFIXES = ("ಹಾಕ", "ಕಟ್ಟ", "डाल", "डलवा", "haak", "daal", "katt")
TAKE_OUT_EXTRA_PREFIXES = ("ಬಿಡಿಸ", "bidis")
DRAW_WORDS = {"ಡ್ರಾ", "draw"}


def _fold_all(values):
    return tuple(fold(v) for v in values)


_SERVICE = {intent: _fold_all(prefixes) for intent, prefixes in SERVICE_WORD_PREFIXES.items()}
_KN_LOAN = {fold(w) for w in KANNADA_LOAN_WORDS}
_ACCOUNT = _fold_all(ACCOUNT_PREFIXES)
_OPEN = _fold_all(OPEN_PREFIXES)
_NEW = {fold(w) for w in NEW_WORDS}
_TAKE_OUT = _fold_all(TAKE_OUT_PREFIXES)
_MONEY = _fold_all(MONEY_PREFIXES)
_LOAN_SUFFIXES = _fold_all(LOAN_SUFFIXES)
_POSSESSIVE = {fold(w) for w in POSSESSIVE_WORDS}
_HOW_MUCH = {fold(w) for w in HOW_MUCH_WORDS}
_REMAINING = _fold_all(REMAINING_PREFIXES)
_REMAINING_WORDS = {fold(w) for w in REMAINING_WORDS}
_ENOUGH = _fold_all(ENOUGH_PREFIXES)
_KN_EXISTENCE = _fold_all(KANNADA_EXISTENCE_ENDINGS)
_HI_OPENERS = {fold(w) for w in HINDI_YES_NO_OPENERS}
_HI_EXISTENCE = {fold(w) for w in HINDI_EXISTENCE_ENDINGS}
_PUT_IN = _fold_all(PUT_IN_PREFIXES)
_TAKE_OUT_EXTRA = _fold_all(TAKE_OUT_EXTRA_PREFIXES)
_DRAW = {fold(w) for w in DRAW_WORDS}


def _bigram(words, first, second):
    return any(a == first and b == second for a, b in zip(words, words[1:]))


def _asks_about_money_held(words):
    """The balance frame's question part: quantity, remaining, enough, yes/no."""

    how_much = any(w in _HOW_MUCH for w in words) or _bigram(words, "how", "much")
    remaining = any(w in _REMAINING_WORDS or w.startswith(_REMAINING) for w in words)
    enough = any(w.startswith(_ENOUGH) for w in words)
    existence = (
        any(w.endswith(_KN_EXISTENCE) for w in words)
        or (bool(words) and words[0] in _HI_OPENERS and words[-1] in _HI_EXISTENCE)
        or _bigram(words, "is", "there")
        or any(words[i:i + 3] == ["do", "i", "have"] for i in range(len(words)))
    )
    return how_much, remaining, enough, existence


def service_evidence(text):
    """The services `text` names unambiguously, as a frozenset of intent labels."""

    # Idempotent: routing text is already canonical, raw text becomes so.
    words = word_tokens(canonicalize_loanwords(text))
    found = set()

    def has(prefixes):
        return any(w.startswith(prefixes) for w in words)

    for intent, prefixes in _SERVICE.items():
        if has(prefixes):
            found.add(intent)

    if any(w in _KN_LOAN for w in words) or any(w.endswith(_LOAN_SUFFIXES) for w in words):
        found.add(LOAN)

    account = has(_ACCOUNT)
    # M10: an amount ("ಐದು ಸಾವಿರ", "2000") is money too.
    money = has(_MONEY) or extract_amount(" ".join(words)) is not None

    if account and (has(_OPEN) or any(w in _NEW for w in words)):
        found.add(OPEN_ACCOUNT)

    if has(_TAKE_OUT):
        if money:
            found.add(WITHDRAW)
        elif account:
            found.add(OPEN_ACCOUNT)

    # --- service phrasing (M10): see the module docstring ----------------
    if money:
        put_in = (has(_PUT_IN) or _bigram(words, "pay", "in")
                  or ("put" in words and ("in" in words or "into" in words)))
        if put_in:
            found.add(DEPOSIT)
        take_out = (has(_TAKE_OUT_EXTRA) or any(w in _DRAW for w in words)
                    or ("take" in words and "out" in words))
        if take_out:
            found.add(WITHDRAW)

    if not found:
        how_much, remaining, enough, existence = _asks_about_money_held(words)
        possessive = any(w in _POSSESSIVE for w in words)
        if (((how_much or remaining or enough or existence) and money and (account or possessive))
                or (remaining and account) or (how_much and account and possessive)):
            found.add(BALANCE)

    return frozenset(found)
