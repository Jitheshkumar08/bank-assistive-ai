"""Routing safety cues for the workflow-start decision (M10).

WHY

The M10 diagnosis (evaluation/reports/m10_diagnosis.md) traced 92 of 96
wrong decisions on the real-speech banking clips to one rule: when a
sentence named no service, IntentDetector chose among all five services by
embedding similarity alone and started the winner whenever it beat the
non-banking anchors by BANKING_MARGIN. Two facts make that unsafe:

  - For Kannada, every sentence scores about 0.93 against every service and
    the top two are 0.011 apart (median), so the chosen service is close to
    noise.
  - There is no anchor for a banking operation the assistant does not offer
    (transfers, UPI, bill payments, wallets, cards, insurance), so such
    requests beat the anchors that do exist -- by MORE than real requests do
    in Kannada (median margin 0.208 against 0.170). No threshold separates
    them, and the threshold is not changed here.

WHAT THIS MODULE PROVIDES

Two lists of words, matched like service_keywords: whole folded words, by
prefix so inflection does not matter. Nothing is trained.

  information_question_cues(text)
      Words that make a sentence a question ABOUT a service -- how, limits,
      documents, eligibility, interest, charges, procedure, rules, why,
      when -- rather than a request to perform it. "what is the maximum I
      can withdraw" names a withdrawal and is not one.

  unsupported_operation_cues(text)
      Words that name a banking operation the assistant does not offer.

IntentDetector applies them only to a sentence it would otherwise START a
workflow for; see detector.py ("THE M10 START RULE"). They can only turn a
start into an abstention, never create a start.

Lists are deliberately ordinary words a customer uses. Generic words that also
appear in supported requests are left out on purpose: "pay" ("pay in" is a
deposit), "card" alone ("my ATM card is not working, I need cash"), "fee"
("deposit the school fee"), "what" ("what is my balance").
"""

from app.dialogue.multilingual_phrases import fold, word_tokens
from app.dialogue.text_normalization import canonicalize_loanwords

# ---------------------------------------------------------------------------
# Questions about a service
# ---------------------------------------------------------------------------

#: Matched by prefix on one word.
INFORMATION_PREFIXES = (
    # how
    "ಹೇಗೆ", "कैसे", "hege", "kaise",
    # limits
    "maximum", "minimum", "limit", "ಮಿತಿ", "ಗರಿಷ್ಠ", "ಕನಿಷ್ಠ", "अधिकतम", "न्यूनतम", "सीमा",
    # documents and forms
    "document", "ದಾಖಲೆ", "दस्तावेज", "डॉक्यूमेंट", "डाक्यूमेंट", "कागज", "kagaz",
    "form", "ಫಾರ್ಮ್", "फॉर्म", "फार्म",
    # eligibility, interest, charges
    "eligib", "ಅರ್ಹತೆ", "पात्रता", "interest", "ಬಡ್ಡಿ", "ब्याज", "byaj", "charges", "charged", "ಶುಲ್ಕ", "शुल्क",
    # procedure and rules
    "procedure", "process", "ಪ್ರಕ್ರಿಯೆ", "प्रक्रिया", "rule", "ನಿಯಮ", "नियम",
    # why, when
    "why", "ಯಾಕೆ", "ಏಕೆ", "क्यों", "kyun", "kyon", "ಯಾವಾಗ", "when",
)

#: Matched as exact words: short forms whose prefix is unsafe.
INFORMATION_WORDS = {"how", "charge", "कब", "kab"}

#: "how much" / "how many" ask for a quantity, which is how a balance enquiry
#: is phrased; they are not a question about a service.
_HOW_EXCEPTIONS = {"much", "many"}

# ---------------------------------------------------------------------------
# Operations the assistant does not offer
# ---------------------------------------------------------------------------

UNSUPPORTED_PREFIXES = (
    # transfers and sending money to someone
    "transfer", "ಟ್ರಾನ್ಸ್ಫರ್", "ट्रांसफर", "ट्रान्सफर", "neft", "rtgs", "imps",
    "send", "ಕಳಿಸ", "ಕಳುಹಿಸ", "ಕಳ್ಸ", "भेज", "bhej", "kalis", "kalas",
    # UPI, payment apps, wallets
    "upi", "ಯುಪಿಐ", "यूपीआई", "gpay", "phonepe", "ಫೋನ್ಪೇ", "फोनपे", "paytm", "ಪೇಟಿಎಂ", "पेटीएम",
    "mobikwik", "bhim", "payzapp", "ಪೇಜ್ಯಾಪ್", "freecharge", "फ्रीचार्ज", "wallet", "ವ್ಯಾಲೆಟ್", "वॉलेट", "वालेट",
    # bills, recharges, payments, instalments
    "bill", "ಬಿಲ್", "बिल", "recharge", "ರೀಚಾರ್ಜ್", "रिचार्ज", "fastag",
    "payment", "ಪೇಮೆಂಟ್", "पेमेंट", "भुगतान", "ಪಾವತಿ", "ಮರುಪಾವತಿ", "repay", "instalment", "installment",
    "ಕಂತು", "किस्त", "emi",
    # card management
    "block", "ಬ್ಲಾಕ್", "ब्लॉक", "ब्लाक",
    # insurance and investments
    "insurance", "ಇನ್ಶೂರೆನ್ಸ್", "इंश्योरेंस", "बीमा", "ವಿಮೆ", "mutual", "ಮ್ಯೂಚುವಲ್", "म्यूचुअल",
    "invest", "ಹೂಡಿಕೆ", "निवेश", "shares",
    # other app operations
    "otp", "ಓಟಿಪಿ", "ओटीपी", "qr", "ಕ್ಯೂಆರ್", "क्यूआर", "reward", "ರಿವಾರ್ಡ್", "रिवॉर्ड", "cashback",
    "कैशबैक", "refund", "ರೀಫಂಡ್", "रिफंड", "donat",
)

#: Two-word names: (first word prefix, second word prefix).
UNSUPPORTED_PAIRS = (
    ("google", "pay"), ("ಗೂಗಲ್", "ಪೇ"), ("गूगल", "पे"), ("amazon", "pay"), ("ಅಮೇಜಾನ್", "ಪೇ"),
    ("अमेज़न", "पे"), ("credit", "card"), ("debit", "card"), ("ಕ್ರೆಡಿಟ್", "ಕಾರ್ಡ"), ("ಡೆಬಿಟ್", "ಕಾರ್ಡ"),
    ("क्रेडिट", "कार्ड"), ("डेबिट", "कार्ड"), ("ಕ್ಯೂ", "ಆರ್"), ("क्यू", "आर"),
    # payment apps written as brand words or spelled out (policy D3)
    ("airtel", "money"), ("एयरटेल", "मनी"), ("ಏರ್ಟೆಲ್", "ಮನಿ"), ("ola", "money"), ("ಓಲಾ", "ಮನಿ"),
    ("pay", "zapp"), ("ಪೇ", "ಜ್ಯಾಪ್"), ("ಪೇ", "ಝ್ಯಾಪ್"), ("ಪೇ", "ಟಿ"), ("पे", "टी"),
)


# ---------------------------------------------------------------------------
# Approved policy (evaluation/reports/m10_policy_decisions.md)
#
# These cues decline even when the sentence also names a supported service:
#
#   D1 / D6  anything about a WALLET -- topping it up is not a cash deposit,
#            its balance is not a bank balance
#   D3       repaying a loan THROUGH A PAYMENT APP -- never a loan
#            application; the knowledge base has nothing on it
#   D7       an app or balance that is NOT SHOWING -- a complaint, not a
#            balance enquiry and not a refusal
# ---------------------------------------------------------------------------

WALLET_PREFIXES = ("wallet", "ವ್ಯಾಲೆಟ್", "वॉलेट", "वालेट")

PAYMENT_APP_PREFIXES = ("upi", "ಯುಪಿಐ", "यूपीआई", "gpay", "phonepe", "ಫೋನ್ಪೇ", "फोनपे", "paytm", "ಪೇಟಿಎಂ",
                        "पेटीएम", "mobikwik", "bhim", "payzapp", "ಪೇಜ್ಯಾಪ್", "freecharge", "फ्रीचार्ज")
#: Brand names written as two words, or spelled out letter by letter (ಪೇ ಟಿ ಎಮ್ = Paytm).
PAYMENT_APP_PAIRS = (("google", "pay"), ("ಗೂಗಲ್", "ಪೇ"), ("गूगल", "पे"), ("amazon", "pay"), ("ಅಮೇಜಾನ್", "ಪೇ"),
                     ("अमेज़न", "पे"), ("airtel", "money"), ("एयरटेल", "मनी"), ("ಏರ್ಟೆಲ್", "ಮನಿ"), ("ola", "money"),
                     ("ಓಲಾ", "ಮನಿ"), ("pay", "zapp"), ("ಪೇ", "ಜ್ಯಾಪ್"), ("ಪೇ", "ಝ್ಯಾಪ್"), ("ಪೇ", "ಟಿ"), ("पे", "टी"))
REPAYMENT_PREFIXES = ("repay", "ಮರುಪಾವತಿ", "ಕಂತು", "किस्त", "emi", "instalment", "installment", "भुगतान")

#: D7: "not showing" -- a display verb with a negation that DESCRIBES (it is
#: not showing), not one that INSTRUCTS (don't show me): imperative
#: negatives (मत, ಬೇಡ, don't) stay refusals.
DISPLAY_PREFIXES = ("show", "display", "ತೋರ", "ಕಾಣ", "दिख", "dikh")
DESCRIPTIVE_NEGATIONS = {"not", "isn't", "isnt", "aren't", "wasn't", "doesn't", "doesnt", "didn't", "didnt", "won't",
                         "nahi", "nahin",
                         "नहीं", "नही"}
KANNADA_DESCRIPTIVE_NEGATIVE_ENDING = "ಲ್ಲ"
APP_PREFIXES = ("app", "ಆ್ಯಪ್", "ಆಪ್", "ऐप", "एप")
BALANCE_WORD_PREFIXES = ("balance", "ಶಿಲ್ಕು", "शेष")


def _fold_all(values):
    return tuple(fold(v) for v in values)


_INFO = _fold_all(INFORMATION_PREFIXES)
_INFO_WORDS = {fold(w) for w in INFORMATION_WORDS}
_UNSUPPORTED = _fold_all(UNSUPPORTED_PREFIXES)
_UNSUPPORTED_PAIRS = tuple((fold(a), fold(b)) for a, b in UNSUPPORTED_PAIRS)


def _words(text):
    # Idempotent on routing text, as in service_keywords.
    return word_tokens(canonicalize_loanwords(text or ""))


def information_question_cues(text):
    """The words that make `text` a question about a service (a set; empty when none)."""

    words = _words(text)
    found = set()
    for index, word in enumerate(words):
        if word == "how" and index + 1 < len(words) and words[index + 1] in _HOW_EXCEPTIONS:
            continue
        if word in _INFO_WORDS or word.startswith(_INFO):
            found.add(word)
    return found


def unsupported_operation_cues(text):
    """The words that name an operation the assistant does not offer (a set; empty when none)."""

    words = _words(text)
    found = {w for w in words if w.startswith(_UNSUPPORTED)}
    for first, second in zip(words, words[1:]):
        for a, b in _UNSUPPORTED_PAIRS:
            if first.startswith(a) and second.startswith(b):
                found.add(f"{first} {second}")
    return found


_WALLET = _fold_all(WALLET_PREFIXES)
_PAYMENT_APP = _fold_all(PAYMENT_APP_PREFIXES)
_PAYMENT_APP_PAIRS = tuple((fold(a), fold(b)) for a, b in PAYMENT_APP_PAIRS)
_REPAYMENT = _fold_all(REPAYMENT_PREFIXES)
_DISPLAY = _fold_all(DISPLAY_PREFIXES)
_DESCRIPTIVE_NEGATIONS = {fold(w) for w in DESCRIPTIVE_NEGATIONS}
_KN_NEGATIVE_ENDING = fold(KANNADA_DESCRIPTIVE_NEGATIVE_ENDING)
_APP = _fold_all(APP_PREFIXES)
_BALANCE_WORDS = _fold_all(BALANCE_WORD_PREFIXES)


def declined_regardless_cues(text):
    """
    Approved-policy cues (D1, D3, D6) that decline even beside a supported
    service: a wallet, or repaying a loan through a payment app. A set; empty
    when none.
    """

    words = _words(text)
    found = {w for w in words if w.startswith(_WALLET)}

    app = {w for w in words if w.startswith(_PAYMENT_APP)}
    for first, second in zip(words, words[1:]):
        for a, b in _PAYMENT_APP_PAIRS:
            if first.startswith(a) and second.startswith(b):
                app.add(f"{first} {second}")
    repayment = {w for w in words if w.startswith(_REPAYMENT)}
    if app and repayment:
        found |= app | repayment
    return found


def troubleshooting_cues(text):
    """
    D7: an app or a balance that is not showing. A set; empty when none.

    A display verb, a DESCRIPTIVE negation (it is not showing / नहीं दिख रहा /
    ತೋರಿಸ್ತಿಲ್ಲ), and an app or balance word.
    """

    words = _words(text)
    display = [w for w in words if w.startswith(_DISPLAY)]
    if not display:
        return set()
    negated = (any(w in _DESCRIPTIVE_NEGATIONS for w in words)
               or any(w.endswith(_KN_NEGATIVE_ENDING) for w in display))
    subject = [w for w in words if w.startswith(_APP) or w.startswith(_BALANCE_WORDS) or w.startswith(_PAYMENT_APP)]
    if negated and subject:
        return set(display) | set(subject)
    return set()
