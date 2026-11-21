"""Preparing a customer's question for retrieval (M7).

The knowledge base is written in English. The embedding model aligns Kannada
with English weakly -- before M7 a Kannada question about loan documents
retrieved account_number.md, and the same question in English retrieved
loan.md -- and no translation model is available.

What IS available is the vocabulary of the knowledge base itself. Its titles,
headings and body use a small set of banking nouns (account, slip, deposit,
withdrawal, loan, interest, documents, eligibility ...). The table below
gives the everyday Kannada, Hindi and romanised words for exactly those
nouns. When a question contains them, retrieval also searches with the
English terms, so the question can meet the article on its own words.

RULES FOR THE TABLE

  - Every English term is one the knowledge base uses. The table was built
    from the articles' vocabulary, never from evaluation questions.
  - Words with two meanings are left out: ತೆಗೆ is "withdraw" or "open", ಚೆಕ್
    is "check" or "cheque". ಸಾಲ ("loan") is matched by exact form because
    its prefix also begins ಸಾಲು ("queue").
  - Loanwords need no entry: the routing text (text_normalization) has
    already written ಲೋನ್ / लोन as "loan".

The ORIGINAL question is untouched: this produces an extra, retrieval-only
query. The LLM is still shown the question the customer asked.
"""

from app.dialogue.text_normalization import fold_word, word_tokens

#: English knowledge-base term -> native words, matched as word PREFIXES.
GLOSSARY = {
    "account": ("ಖಾತೆ", "खाता", "खाते", "khata", "khate", "khaata", "khaate"),
    "number": ("ಸಂಖ್ಯೆ", "संख्या", "नंबर", "sankhya", "nambar"),
    "withdrawal": ("ಹಿಂಪಡೆ", "निकासी", "निकाल", "nikasi", "nikal"),
    "slip": ("ಚೀಟಿ", "पर्ची", "parchi", "cheeti"),
    "deposit": ("ಜಮಾ", "ಠೇವಣಿ", "जमा", "jama"),
    "documents": ("ದಾಖಲೆ", "दस्तावेज", "कागजात", "dastavej", "dastavez", "dakhale"),
    "application": ("ಅರ್ಜಿ", "आवेदन", "अर्जी", "arji", "aavedan"),
    "signature": ("ಸಹಿ", "हस्ताक्षर", "दस्तखत", "sahi", "hastakshar"),
    "savings": ("ಉಳಿತಾಯ", "बचत", "bachat", "ulitaya"),
    "current": ("ಚಾಲ್ತಿ", "चालू", "chalu", "chaalti"),
    "loan": ("ऋण", "कर्ज", "karz"),
    "interest": ("ಬಡ್ಡಿ", "ब्याज", "byaj", "baddi"),
    "instalment": ("ಕಂತು", "किस्त", "kist", "kantu"),
    "tenure": ("ಅವಧಿ", "अवधि", "avadhi"),
    "identity": ("ಗುರುತ", "ಗುರುತಿನ", "पहचान", "pehchaan", "guruth"),
    "transfer": ("ವರ್ಗಾವಣೆ", "ಕಳುಹಿಸ", "ಕಳಿಸ", "भेज", "हस्तांतरण", "bhej", "kalis"),
    "payment": ("ಪಾವತಿ", "भुगतान", "bhugtan", "paavati"),
    "cash": ("ನಗದು", "नकद", "nakad", "nagadu"),
    "services": ("ಸೇವೆ", "सेवा", "सेवाए", "seva", "seve"),
    "eligibility": ("ಅರ್ಹತೆ", "पात्रता", "patrata", "arhate"),
    "opening": ("ತೆರೆ", "खोल", "खुल", "khol", "tere"),
    "requirements": ("ಅಗತ್ಯ", "आवश्यक", "जरूरी", "zaroori", "jaroori"),
    "approval": ("ಮಂಜೂರು", "मंजूरी", "manjoori"),
    "amount": ("ಮೊತ್ತ", "राशि", "रकम", "rashi", "rakam", "motta"),
    "branch": ("ಶಾಖೆ", "शाखा", "shakha", "shaakhe"),
    "money": ("ಹಣ", "ದುಡ್ಡು", "पैसा", "पैसे", "paise", "paisa", "hana", "duddu"),
    "process": ("ಪ್ರಕ್ರಿಯೆ", "ವಿಧಾನ", "प्रक्रिया", "तरीका", "prakriya", "tarika", "vidhana"),
}

#: ಸಾಲ by exact form: its prefix also begins ಸಾಲು (a queue).
KANNADA_LOAN_WORDS = {"ಸಾಲ", "ಸಾಲದ", "ಸಾಲಕ್ಕೆ", "ಸಾಲಕ್ಕಾಗಿ", "ಸಾಲವನ್ನು", "ಸಾಲವು", "ಸಾಲಗಳು", "ಸಾಲದಲ್ಲಿ"}

#: Two-word native names of a knowledge-base subject.
GLOSSARY_PAIRS = {
    ("ಖಾತೆ", "ಪುಸ್ತಕ"): "passbook",
    ("खाता", "पुस्तिका"): "passbook",
}

_PREFIXES = tuple((fold_word(p), term) for term, prefixes in GLOSSARY.items() for p in prefixes)
_KN_LOAN = {fold_word(w) for w in KANNADA_LOAN_WORDS}
_PAIRS = {(fold_word(a), fold_word(b)): term for (a, b), term in GLOSSARY_PAIRS.items()}


def knowledge_terms(text):
    """The knowledge-base terms `text` names, in first-mention order."""
    words = word_tokens(text)
    found = []

    def add(term):
        if term not in found:
            found.append(term)

    for index, word in enumerate(words):
        if index + 1 < len(words):
            pair = None
            for (a, b), term in _PAIRS.items():
                if word.startswith(a) and words[index + 1].startswith(b):
                    pair = term
            if pair:
                add(pair)
        if word in _KN_LOAN:
            add("loan")
        for prefix, term in _PREFIXES:
            if word.startswith(prefix):
                add(term)
    return found


def retrieval_queries(question):
    """
    The queries to search with, best first: the question itself, then -- if it
    names knowledge-base terms in Kannada, Hindi or romanised form -- those
    terms in English. Retrieval takes the best match across both.
    """
    queries = [question]
    terms = knowledge_terms(question)
    if terms:
        english = " ".join(terms)
        if english.lower() != (question or "").lower():
            queries.append(english)
    return queries
