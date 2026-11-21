"""Tulu text normalization, script handling and transliteration.

FOUR KINDS OF TEXT, KEPT SEPARATE

  tcy-Latn   Romanized Tulu, as the native-speaker annotator writes it
             ("Yank duddu padodu?"). AUTHORITATIVE for this project.
  tcy-Knda   Tulu written in Kannada script. Produced here from tcy-Latn by
             deterministic transliteration; NOT yet native-speaker reviewed.
  kn         Kannada LANGUAGE. Same script as tcy-Knda, different language.
             Nothing here ever relabels Kannada-script text as Tulu without
             lexical evidence, and nothing relabels Tulu as Kannada.
  en         English. Banking loanwords (deposit, slip, amount, ...) occur
             inside Tulu sentences and stay Tulu sentences.

WHAT IS NEVER CHANGED

The authoritative Romanized text. Normalization produces (a) a tidied display
form (whitespace, quotes) and (b) a separate MATCHING KEY used only to compare
strings; the key is never shown or stored as the customer's words.

TRANSLITERATION POLICY (roman_to_kannada)

The annotator's spelling is followed literally -- no word is "corrected" to a
dictionary form. Rules: doubled vowels are long (aa, ee/ii, oo/uu); "th"/"dh"
are dental; a single t/d is dental at the start of a word and retroflex inside
it (duddu -> ದುಡ್ಡು, padodu -> ಪಡೊಡು); n/m before a stop becomes anusvara;
a word-final consonant takes virama. English loanwords use the spellings in
data/loanwords.json. The annotator writes case suffixes as separate tokens
("amount n", "counter d", "deposit dh"); they are attached to the word before.
Every output of this function is pending native-speaker review.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

TULU = "tcy"
TULU_LATIN = "tcy-Latn"
TULU_KANNADA = "tcy-Knda"

ZWNJ = "‌"
VIRAMA = "್"
ANUSVARA = "ಂ"


# =========================================================
# SCRIPT DETECTION
# =========================================================

def char_script(char: str):
    if not unicodedata.category(char).startswith(("L", "M")):
        return None
    if "ಀ" <= char <= "೿":
        return "kannada"
    if "ऀ" <= char <= "ॿ":
        return "devanagari"
    if char.isascii():
        return "latin"
    return "other"


def detect_script(text: str) -> str:
    """'latin', 'kannada', 'devanagari', 'mixed', 'other' or 'none'."""
    seen = {s for s in (char_script(c) for c in text or "") if s}
    if not seen:
        return "none"
    if len(seen) == 1:
        return seen.pop()
    return "mixed"


# =========================================================
# DISPLAY NORMALIZATION AND MATCHING KEYS
# =========================================================

_QUOTES = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})


def normalize_display(text: str) -> str:
    """Whitespace and quote tidying only. Spelling is untouched."""
    return " ".join((text or "").translate(_QUOTES).split())


#: Folds applied to MATCHING KEYS only, in order. They remove distinctions
#: that informal romanization and ASR transliteration do not make reliably.
_KEY_FOLDS = [
    (re.compile(r"([a-z])\1+"), r"\1"),   # doubled letters (aa, kk, dd)
    (re.compile(r"(?<=[kgcjtdpb])h"), ""),  # aspiration / dental marking
    (re.compile(r"sh"), "s"),
    (re.compile(r"w"), "v"),
    (re.compile(r"z"), "j"),
    (re.compile(r"[cq]"), "k"),
    (re.compile(r"x"), "ks"),
    (re.compile(r"ee"), "i"),
    (re.compile(r"oo"), "u"),
]


def matching_tokens(text: str) -> list[str]:
    """Lower-case phonetic keys for each word of Romanized text."""
    words = re.findall(r"[a-z]+", (text or "").lower())
    keys = []
    for word in words:
        key = word
        for pattern, repl in _KEY_FOLDS:
            key = pattern.sub(repl, key)
        keys.append(key)
    return keys


def matching_key(text: str) -> str:
    return " ".join(matching_tokens(text))


# =========================================================
# ROMANIZED TULU -> KANNADA SCRIPT  (speech front end)
# =========================================================

_VOWELS = [  # longest first: (roman, independent, sign)
    ("aa", "ಆ", "ಾ"), ("ai", "ಐ", "ೈ"), ("au", "ಔ", "ೌ"),
    ("ee", "ಈ", "ೀ"), ("ii", "ಈ", "ೀ"), ("oo", "ಊ", "ೂ"), ("uu", "ಊ", "ೂ"),
    ("a", "ಅ", ""), ("e", "ಎ", "ೆ"), ("i", "ಇ", "ಿ"), ("o", "ಒ", "ೊ"), ("u", "ಉ", "ು"),
]
_CONSONANTS = [  # longest first
    ("chh", "ಛ"), ("ch", "ಚ"), ("kh", "ಖ"), ("gh", "ಘ"), ("jh", "ಝ"),
    ("th", "ತ"), ("dh", "ದ"), ("ph", "ಫ"), ("bh", "ಭ"), ("sh", "ಶ"),
    ("k", "ಕ"), ("c", "ಕ"), ("q", "ಕ"), ("g", "ಗ"), ("j", "ಜ"), ("z", "ಜ"),
    ("t", None), ("d", None),          # position-dependent, see below
    ("n", "ನ"), ("p", "ಪ"), ("b", "ಬ"), ("m", "ಮ"), ("y", "ಯ"), ("r", "ರ"),
    ("l", "ಲ"), ("v", "ವ"), ("w", "ವ"), ("s", "ಸ"), ("h", "ಹ"), ("f", "ಫ"),
    ("x", "ಕ್ಸ"),
]
_STOP_LETTERS = set("kgcjtdpbq")
#: Case suffixes the annotators write as separate tokens ("amount n",
#: "counter d", "deposit dh") or hyphenated ("slip-g", "cashier-g").
_SUFFIXES = {"n": "ನ್", "d": "ಡ್", "dh": "ದ", "g": "ಗ್"}


@lru_cache(maxsize=1)
def loanwords() -> dict:
    data = json.loads((DATA_DIR / "loanwords.json").read_text(encoding="utf-8"))
    return {k.lower(): v for k, v in data["words"].items()}


def _word_to_kannada(word: str) -> str:
    w = word.lower()
    out = []
    i = 0
    pending_consonant = False   # last emitted item is a bare consonant
    while i < len(w):
        vowel = next(((r, ind, sign) for r, ind, sign in _VOWELS if w.startswith(r, i)), None)
        if vowel:
            r, independent, sign = vowel
            out.append(sign if pending_consonant else independent)
            pending_consonant = False
            i += len(r)
            continue
        cons = next(((r, k) for r, k in _CONSONANTS if w.startswith(r, i)), None)
        if cons is None:          # not a letter we map; keep as is
            out.append(w[i])
            pending_consonant = False
            i += 1
            continue
        r, letter = cons
        nxt = w[i + len(r):i + len(r) + 1]
        if letter is None:
            initial = i == 0
            letter = ("ತ" if initial else "ಟ") if r == "t" else ("ದ" if initial else "ಡ")
        if r in ("n", "m") and nxt and nxt in _STOP_LETTERS and (r == "n" or nxt in "pb"):
            # nasal before a stop: anusvara (undu -> ಉಂಡು)
            if pending_consonant and out and out[-1] == letter:
                # a doubled nasal before a stop ("annd") is ONE nasal: the
                # pending one becomes the anusvara (annd -> ಅಂಡ್, not ಅನ್ಂಡ್)
                out[-1] = ANUSVARA
                pending_consonant = False
                i += len(r)
                continue
            if pending_consonant:
                out.append(VIRAMA)
            out.append(ANUSVARA if out else letter)
            pending_consonant = False
            i += len(r)
            continue
        if pending_consonant:
            out.append(VIRAMA)
        out.append(letter)
        pending_consonant = True
        i += len(r)
    if pending_consonant:
        out.append(VIRAMA)
    return "".join(out)


def roman_to_kannada(text: str) -> str:
    """Romanized Tulu -> Kannada-script Tulu (pending native review)."""
    parts = re.findall(r"[A-Za-z]+|[^A-Za-z]+", normalize_display(text))
    out: list[str] = []
    last_word_index = None
    for part in parts:
        if not part[0].isalpha():
            out.append(part)
            continue
        low = part.lower()
        if low in _SUFFIXES and last_word_index is not None and out[-1] in (" ", "-"):
            # "amount n" / "slip-g" -> "ಅಮೌಂಟ್‌ನ್" / "ಸ್ಲಿಪ್‌ಗ್": drop the
            # separator, join with ZWNJ
            out.pop()
            out[last_word_index] += ZWNJ + _SUFFIXES[low]
            continue
        out.append(loanwords().get(low) or _word_to_kannada(low))
        last_word_index = len(out) - 1
    return "".join(out)


# =========================================================
# KANNADA / DEVANAGARI -> ROMAN  (for comparing ASR output)
# =========================================================

_KN_CONS = dict(zip(
    "ಕಖಗಘಙಚಛಜಝಞಟಠಡಢಣತಥದಧನಪಫಬಭಮಯರಲವಶಷಸಹಳ",
    ["k", "kh", "g", "gh", "n", "ch", "chh", "j", "jh", "n", "t", "th", "d", "dh", "n",
     "t", "th", "d", "dh", "n", "p", "ph", "b", "bh", "m", "y", "r", "l", "v", "sh", "sh",
     "s", "h", "l"]))
_KN_VOWEL = dict(zip("ಅಆಇಈಉಊಋಎಏಐಒಓಔ", ["a", "aa", "i", "ee", "u", "oo", "ru", "e", "e", "ai", "o", "o", "au"]))
_KN_SIGN = dict(zip("ಾಿೀುೂೃೆೇೈೊೋೌ", ["aa", "i", "ee", "u", "oo", "ru", "e", "e", "ai", "o", "o", "au"]))

_DV_CONS = dict(zip(
    "कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहळ",
    ["k", "kh", "g", "gh", "n", "ch", "chh", "j", "jh", "n", "t", "th", "d", "dh", "n",
     "t", "th", "d", "dh", "n", "p", "ph", "b", "bh", "m", "y", "r", "l", "v", "sh", "sh",
     "s", "h", "l"]))
_DV_VOWEL = dict(zip("अआइईउऊऋएऐओऔऍऑ", ["a", "aa", "i", "ee", "u", "oo", "ru", "e", "ai", "o", "au", "e", "o"]))
_DV_SIGN = dict(zip("ािीुूृेैोौॅॉ", ["aa", "i", "ee", "u", "oo", "ru", "e", "ai", "o", "au", "e", "o"]))


def _indic_to_roman(text, cons, vowel, sign, virama, anusvara, nukta=None):
    out = []
    pending = False   # consonant with inherent 'a' not yet written
    for ch in text:
        if nukta and ch == nukta:
            continue
        if ch in cons:
            if pending:
                out.append("a")
            out.append(cons[ch])
            pending = True
        elif ch in sign:
            out.append(sign[ch])
            pending = False
        elif ch == virama:
            pending = False
        elif ch in vowel:
            if pending:
                out.append("a")
            out.append(vowel[ch])
            pending = False
        elif ch in anusvara:
            if pending:
                out.append("a")
            out.append("n")
            pending = False
        else:
            if pending:
                out.append("a")
            pending = False
            out.append(ch if ch.isascii() else " ")
    if pending:
        out.append("a")
    return re.sub(r"\s+", " ", "".join(out)).strip()


def kannada_to_roman(text: str) -> str:
    return _indic_to_roman(text, _KN_CONS, _KN_VOWEL, _KN_SIGN, VIRAMA, {"ಂ", "ಃ"})


def devanagari_to_roman(text: str) -> str:
    return _indic_to_roman(text, _DV_CONS, _DV_VOWEL, _DV_SIGN, "्", {"ं", "ँ", "ः"}, nukta="़")


def to_roman(text: str) -> str:
    """Any supported script -> Roman letters, for matching only."""
    text = text or ""
    if any("ಀ" <= c <= "೿" for c in text):
        text = kannada_to_roman(text)
    if any("ऀ" <= c <= "ॿ" for c in text):
        text = devanagari_to_roman(text)
    return text.lower()


# =========================================================
# LANGUAGE CLASSIFICATION (evidence-based, never by script alone)
# =========================================================

@lru_cache(maxsize=1)
def verified_tulu_vocabulary() -> frozenset:
    """Matching keys of every non-loanword in the verified utterances."""
    from app.tulu.data.dataset import all_utterances   # local import: avoid a cycle
    loans = {matching_key(w) for w in loanwords()}
    vocab = set()
    for utt in all_utterances():
        for key in matching_tokens(utt["tulu_romanized"]):
            if key not in loans and len(key) > 1:
                vocab.add(key)
    return frozenset(vocab)


def classify_text(text: str) -> dict:
    """
    Which of tcy-Latn / tcy-Knda / kn-or-unknown / en / unknown the text is.

    Tulu is claimed only when at least one verified Tulu word is present.
    Kannada-script text without that evidence is reported as
    'kn-or-unknown', never as Tulu.
    """
    script = detect_script(text)
    keys = matching_tokens(to_roman(text))
    vocab = verified_tulu_vocabulary()
    tulu_hits = [k for k in keys if k in vocab]
    if script in ("latin", "mixed") and tulu_hits:
        label = TULU_LATIN
    elif script == "kannada" and tulu_hits:
        label = TULU_KANNADA
    elif script == "kannada":
        label = "kn-or-unknown"
    elif script == "latin":
        label = "en"
    else:
        label = "unknown"
    return {"label": label, "script": script, "tulu_evidence": tulu_hits}
