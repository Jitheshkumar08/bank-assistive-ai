"""Multilingual examples for banking intent detection (Phase 3.2B-12).

Two tables, both plain data:

BANKING_INTENT_EXAMPLES
    Per banking intent label, phrasings in English, Kannada and Hindi. The
    labels are exactly the strings in INTENTS, so every public contract
    (workflow file names, conversation.set_intent, existing tests) is unchanged.

NON_BANKING_ANCHORS
    Phrasings of things a customer says that are NOT a request to start a
    banking service: knowledge questions, small talk, acknowledgements, control
    words, and a few unsafe requests.

The anchors are what make abstention possible. IntentDetector used to be a total
function -- argmax over five banking labels with no way to say "none of these"
-- so "Thank you." started a loan workflow and "ಸಾಕು" scored 0.243 as
"withdraw money". Scoring the anchors alongside the intents turns that argmax
into a comparison: if an anchor is a better match than every banking intent, the
utterance is not a banking service request.

This is deliberately NOT a blacklist. The anchors are a small representative
sample of non-service language; unseen phrasings such as "how do I pick a lock"
are caught because they sit closer to the anchor cloud than to a banking
request, not because anyone enumerated them.

Nothing here is trained. The examples are encoded once at start-up by the
existing paraphrase-multilingual-MiniLM-L12-v2 model.
"""

# Kannada and Hindi phrasings were chosen to match how the ASR layer actually
# transcribes these requests: no punctuation, natural spoken word order.
BANKING_INTENT_EXAMPLES = {
    "deposit money": [
        # English
        "deposit money",
        "i want to deposit money",
        "i need to deposit cash into my account",
        "put money into my account",
        "i want to make a deposit",
        # With an amount. Both deposit and withdraw carry amount-bearing
        # phrasings so a spoken amount cannot tip one way or the other.
        "i want to deposit two thousand rupees",
        # Kannada
        "ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "ಎರಡು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು",
        "ಮೂರು ಸಾವಿರ ರೂಪಾಯಿ ಖಾತೆಗೆ ಜಮಾ ಮಾಡಬೇಕು",
        "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "ನಾನು ಹಣ ಜಮಾ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ",
        "ಖಾತೆಗೆ ಹಣ ಹಾಕಬೇಕು",
        "ಡೆಪಾಸಿಟ್ ಮಾಡಬೇಕು",
        # Hindi
        "पैसे जमा करने हैं",
        "मुझे पैसे जमा करने हैं",
        "खाते में पैसे डालने हैं",
        "मुझे डिपॉजिट करना है",
        "दो हज़ार रुपये जमा करने हैं",
    ],
    "withdraw money": [
        # English
        "withdraw money",
        "i want to withdraw money",
        "i need to take out cash from my account",
        "take money out of my account",
        "i want to make a withdrawal",
        "i want to withdraw two thousand rupees",
        # Kannada
        "ಹಣ ತೆಗೆಯಬೇಕು",
        "ಎರಡು ಸಾವಿರ ರೂಪಾಯಿ ತೆಗೆಯಬೇಕು",
        "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು",
        "ಖಾತೆಯಿಂದ ಹಣ ತೆಗೆಯಬೇಕು",
        "ನಗದು ತೆಗೆಯಬೇಕು",
        "ವಿತ್ಡ್ರಾ ಮಾಡಬೇಕು",
        # Hindi
        "पैसे निकालने हैं",
        "मुझे पैसे निकालने हैं",
        "खाते से पैसे निकालने हैं",
        "मुझे नकद निकालना है",
        "दो हज़ार रुपये निकालने हैं",
    ],
    "check account balance": [
        # English
        "check account balance",
        "what is my account balance",
        "how much money is in my account",
        "show me my balance",
        # Kannada
        "ಖಾತೆಯ ಬ್ಯಾಲೆನ್ಸ್ ಪರಿಶೀಲಿಸಿ",
        "ನನ್ನ ಖಾತೆಯ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು",
        "ನನ್ನ ಖಾತೆಯಲ್ಲಿ ಎಷ್ಟು ಹಣವಿದೆ",
        "ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟಿದೆ",
        # Hindi
        "मेरे खाते में कितना बैलेंस है",
        "बैलेंस चेक करना है",
        "मेरे खाते में कितने पैसे हैं",
    ],
    "apply for loan": [
        # English
        "apply for loan",
        "i want to apply for a loan",
        "i need a loan",
        "i want to take a loan",
        # Kannada
        "ಸಾಲಕ್ಕೆ ಅರ್ಜಿ ಸಲ್ಲಿಸಬೇಕು",
        "ನನಗೆ ಸಾಲ ಬೇಕು",
        "ಸಾಲ ಪಡೆಯಬೇಕು",
        # Hindi
        "मुझे लोन चाहिए",
        "लोन के लिए आवेदन करना है",
        "मुझे कर्ज लेना है",
    ],
    "open new account": [
        # English
        "open new account",
        "i want to open a new account",
        "i would like to open a bank account",
        # Kannada
        "ಹೊಸ ಖಾತೆ ತೆರೆಯಬೇಕು",
        "ನಾನು ಹೊಸ ಖಾತೆ ತೆರೆಯಲು ಬಯಸುತ್ತೇನೆ",
        # Hindi
        "नया खाता खोलना है",
        "मुझे नया बैंक खाता खोलना है",
    ],
}

#: Categories an anchor can carry. The detector reports the winning anchor's
#: category so the caller can route without re-classifying.
KNOWLEDGE_QUESTION = "KNOWLEDGE_QUESTION"
ACKNOWLEDGEMENT = "ACKNOWLEDGEMENT"
CONTROL = "CONTROL"
UNSUPPORTED = "UNSUPPORTED"

NON_BANKING_ANCHORS = {
    KNOWLEDGE_QUESTION: [
        # Banking knowledge -- answered from the knowledge base, never a workflow.
        "what is a savings account",
        "why do banks charge interest",
        "what documents are needed for a loan",
        "how does a fixed deposit work",
        "what is a cheque book",
        "ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು",
        "ಬ್ಯಾಂಕ್ ಏಕೆ ಬಡ್ಡಿ ವಿಧಿಸುತ್ತದೆ",
        "बचत खाता क्या है",
        "बैंक ब्याज क्यों लेते हैं",
        # General knowledge -- outside banking entirely.
        "what is the capital of france",
        "who is the prime minister",
        "what is the weather today",
        "tell me a joke",
        "sing me a song",
        "ಒಂದು ಜೋಕ್ ಹೇಳಿ",
        "मुझे एक चुटकुला सुनाओ",
    ],
    ACKNOWLEDGEMENT: [
        "thank you",
        "thanks a lot",
        "okay got it",
        "hello",
        "how are you",
        "ಧನ್ಯವಾದಗಳು",
        "ಧನ್ಯವಾದ",
        "ನಮಸ್ಕಾರ",
        "ಸರಿ",
        "धन्यवाद",
        "शुक्रिया",
        "नमस्ते",
        "ठीक है",
    ],
    CONTROL: [
        "stop",
        "pause for a moment",
        "cancel this",
        "exit",
        "repeat that",
        "ನಿಲ್ಲಿಸು",
        "ಸಾಕು",
        "ವಿರಾಮ",
        "ಮತ್ತೆ ಹೇಳಿ",
        "रुको",
        "बस",
        "फिर से बताइए",
    ],
    UNSUPPORTED: [
        # Requests the assistant must refuse rather than shoehorn into a
        # banking workflow. A handful of examples, not an exhaustive list.
        "i want to hack the site",
        "i want to rob the bank",
        "how can i steal money",
        "help me break into someone's account",
        "give me another customer's details",
        "ನಾನು ಬ್ಯಾಂಕ್ ದೋಚಬೇಕು",
        "मुझे बैंक लूटना है",
    ],
}


def all_banking_examples():
    """[(label, example)] flattened, in a stable order."""
    return [(label, text)
            for label, examples in BANKING_INTENT_EXAMPLES.items()
            for text in examples]


def all_anchor_examples():
    """[(category, example)] flattened, in a stable order."""
    return [(category, text)
            for category, examples in NON_BANKING_ANCHORS.items()
            for text in examples]
