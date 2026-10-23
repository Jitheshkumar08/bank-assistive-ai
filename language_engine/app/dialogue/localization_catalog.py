"""Authored Kannada and Hindi renderings of the engine's fixed replies (M6).

Plain data. app/dialogue/localization.py reads it; nothing here has logic.

REVIEW STATUS -- READ BEFORE RELYING ON THESE

Every rendering below was AUTHORED by the development assistant, not by a
native speaker, and NONE has been reviewed yet. That includes the eleven
sentences carried over from Phase 3.2B-12, which were authored the same way.
REVIEW_STATUS says so, the review sheet generated from this file
(evaluation/reports/m6_localization_review.md) lists every entry for a
reviewer, and nothing in the engine or its reports may describe these as
native-speaker approved until REVIEW_STATUS is changed by someone who has
actually checked them.

HOW REPLIES ARE MATCHED

The engine composes every fixed reply in English, sentence by sentence
("Okay." + an instruction + "Let me know when you've completed it."). Each
entry in SENTENCES is one such sentence, optionally with slots:

  {instruction}            one of the workflow step instructions (INSTRUCTIONS)
  {workflow} {workflow2}   a workflow name, display or canonical (WORKFLOW_NAMES)
  {current} {requested}    likewise, in the conflict question
  {n} {k}                  a number, kept as digits

Kannada renderings put a noun after a workflow name (ವಿನಂತಿ "request",
ಪ್ರಕ್ರಿಯೆ "process") so case endings attach to the noun, never to the name.
Hindi does the same with अनुरोध / प्रक्रिया. The conflict question uses
the words the conflict resolver recognises (ರದ್ದು, ವಿರಾಮ, ಮುಂದುವರಿಸ /
रद्द, विराम, जारी), so a customer can answer with the words they just heard.

Hindi sentences end in "." rather than "।", matching the 3.2B-12 renderings
(a reviewer may want to change both together).
"""

REVIEW_STATUS = "unreviewed"
AUTHORED_BY = "development assistant (not a native speaker)"

#: Workflow step instructions, keyed by the exact English text in
#: app/workflow/workflows/*.json. A test fails if a step has no entry.
INSTRUCTIONS = {
    "Please take a deposit slip.": {
        "kn": "ದಯವಿಟ್ಟು ಒಂದು ಹಣ ಜಮಾ ಚೀಟಿ (ಡೆಪಾಸಿಟ್ ಸ್ಲಿಪ್) ತೆಗೆದುಕೊಳ್ಳಿ.",
        "hi": "कृपया एक जमा पर्ची (डिपॉज़िट स्लिप) लीजिए.",
    },
    "Fill in your account number.": {
        "kn": "ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ.",
        "hi": "अपना खाता नंबर भरिए.",
    },
    "Enter the amount to deposit.": {
        "kn": "ಜಮಾ ಮಾಡಬೇಕಾದ ಮೊತ್ತವನ್ನು ಬರೆಯಿರಿ.",
        "hi": "जमा की जाने वाली राशि लिखिए.",
    },
    "Submit the slip along with the cash.": {
        "kn": "ಚೀಟಿಯನ್ನು ನಗದಿನೊಂದಿಗೆ ಸಲ್ಲಿಸಿ.",
        "hi": "पर्ची नकद के साथ जमा कर दीजिए.",
    },
    "Please take a withdrawal slip.": {
        "kn": "ದಯವಿಟ್ಟು ಒಂದು ಹಣ ತೆಗೆಯುವ ಚೀಟಿ (ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್) ತೆಗೆದುಕೊಳ್ಳಿ.",
        "hi": "कृपया एक निकासी पर्ची (विड्रॉल स्लिप) लीजिए.",
    },
    "Enter the withdrawal amount.": {
        "kn": "ತೆಗೆಯಬೇಕಾದ ಮೊತ್ತವನ್ನು ಬರೆಯಿರಿ.",
        "hi": "निकाली जाने वाली राशि लिखिए.",
    },
    "Sign the withdrawal slip.": {
        "kn": "ಹಣ ತೆಗೆಯುವ ಚೀಟಿಗೆ ಸಹಿ ಮಾಡಿ.",
        "hi": "निकासी पर्ची पर हस्ताक्षर कीजिए.",
    },
    "Submit the slip to the cashier.": {
        "kn": "ಚೀಟಿಯನ್ನು ಕ್ಯಾಷಿಯರ್‌ಗೆ ನೀಡಿ.",
        "hi": "पर्ची कैशियर को दीजिए.",
    },
    "Please proceed to the loan assistance desk.": {
        "kn": "ದಯವಿಟ್ಟು ಸಾಲ ಸಹಾಯ ಕೌಂಟರ್‌ಗೆ ಹೋಗಿ.",
        "hi": "कृपया लोन सहायता डेस्क पर जाइए.",
    },
    "Collect the loan application form.": {
        "kn": "ಸಾಲದ ಅರ್ಜಿ ನಮೂನೆಯನ್ನು ಪಡೆದುಕೊಳ್ಳಿ.",
        "hi": "लोन आवेदन फ़ॉर्म ले लीजिए.",
    },
    "Keep your identity documents ready.": {
        "kn": "ನಿಮ್ಮ ಗುರುತಿನ ದಾಖಲೆಗಳನ್ನು ಸಿದ್ಧವಾಗಿಟ್ಟುಕೊಳ್ಳಿ.",
        "hi": "अपने पहचान दस्तावेज़ तैयार रखिए.",
    },
}

#: Workflow names, as workflow_conflict.display_name() says them and as the
#: canonical names appear in step references. Each is followed in the
#: templates by a noun (ವಿನಂತಿ / ಪ್ರಕ್ರಿಯೆ / अनुरोध / प्रक्रिया).
_DEPOSIT = {"kn": "ಹಣ ಜಮಾ", "hi": "जमा"}
_WITHDRAW = {"kn": "ಹಣ ತೆಗೆಯುವ", "hi": "निकासी"}
_LOAN = {"kn": "ಸಾಲದ ಅರ್ಜಿ", "hi": "लोन आवेदन"}
_BALANCE = {"kn": "ಬ್ಯಾಲೆನ್ಸ್ ಪರಿಶೀಲನೆ", "hi": "बैलेंस जांच"}
_OPEN = {"kn": "ಹೊಸ ಖಾತೆ ತೆರೆಯುವ", "hi": "नया खाता"}

WORKFLOW_NAMES = {
    "deposit": _DEPOSIT, "deposit money": _DEPOSIT,
    "withdrawal": _WITHDRAW, "withdraw money": _WITHDRAW,
    "loan application": _LOAN, "apply for loan": _LOAN,
    "balance check": _BALANCE, "check account balance": _BALANCE,
    "account opening": _OPEN, "open new account": _OPEN,
}

#: Every fixed sentence the engine says, as (English template, renderings).
SENTENCES = [
    # --- openers and acknowledgements
    ("You're welcome.", {"kn": "ಸ್ವಾಗತ.", "hi": "आपका स्वागत है."}),
    ("Okay.", {"kn": "ಸರಿ.", "hi": "ठीक है."}),
    ("Continuing.", {"kn": "ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ.", "hi": "जारी रख रहा हूँ."}),
    ("Let's continue.", {"kn": "ಮುಂದುವರಿಸೋಣ.", "hi": "आइए जारी रखें."}),
    ("I've noted that.", {"kn": "ಅದನ್ನು ಗಮನಿಸಿದ್ದೇನೆ.", "hi": "मैंने यह नोट कर लिया है."}),

    # --- keeping the customer on their step
    ("Let me know when you've completed it.",
     {"kn": "ಅದನ್ನು ಮುಗಿಸಿದ ನಂತರ ನನಗೆ ತಿಳಿಸಿ.", "hi": "पूरा हो जाने पर मुझे बताइए."}),
    ("Take your time and let me know when you are ready.",
     {"kn": "ನಿಧಾನವಾಗಿ ಮಾಡಿ, ಸಿದ್ಧರಾದಾಗ ತಿಳಿಸಿ.", "hi": "आराम से कीजिए, तैयार होने पर बताइए."}),
    ("You're still on: {instruction}",
     {"kn": "ನೀವು ಇನ್ನೂ ಈ ಹಂತದಲ್ಲಿದ್ದೀರಿ: {instruction}", "hi": "आप अभी भी इस चरण पर हैं: {instruction}"}),
    ("Workflow Completed.", {"kn": "ಪ್ರಕ್ರಿಯೆ ಪೂರ್ಣಗೊಂಡಿದೆ.", "hi": "प्रक्रिया पूरी हो गई."}),

    # --- state of the request
    ("There's nothing active right now.",
     {"kn": "ಈಗ ಯಾವುದೇ ಪ್ರಕ್ರಿಯೆ ಚಾಲನೆಯಲ್ಲಿಲ್ಲ.", "hi": "अभी कोई प्रक्रिया सक्रिय नहीं है."}),
    ("There's no active request right now.",
     {"kn": "ಈಗ ಯಾವುದೇ ವಿನಂತಿ ಚಾಲನೆಯಲ್ಲಿಲ್ಲ.", "hi": "अभी कोई अनुरोध सक्रिय नहीं है."}),
    ("There's no active request to control right now.",
     {"kn": "ಈಗ ನಿಯಂತ್ರಿಸಲು ಯಾವುದೇ ವಿನಂತಿ ಇಲ್ಲ.", "hi": "अभी नियंत्रित करने के लिए कोई अनुरोध नहीं है."}),
    ("There's no active request to refer to right now.",
     {"kn": "ಈಗ ಉಲ್ಲೇಖಿಸಲು ಯಾವುದೇ ಸಕ್ರಿಯ ವಿನಂತಿ ಇಲ್ಲ.", "hi": "अभी संदर्भ के लिए कोई सक्रिय अनुरोध नहीं है."}),
    ("That request is already active.",
     {"kn": "ಆ ವಿನಂತಿ ಈಗಾಗಲೇ ಚಾಲನೆಯಲ್ಲಿದೆ.", "hi": "वह अनुरोध पहले से सक्रिय है."}),
    ("That request is already paused.",
     {"kn": "ಆ ವಿನಂತಿ ಈಗಾಗಲೇ ವಿರಾಮದಲ್ಲಿದೆ.", "hi": "वह अनुरोध पहले से रुका हुआ है."}),
    ("That request is still paused.",
     {"kn": "ಆ ವಿನಂತಿ ಇನ್ನೂ ವಿರಾಮದಲ್ಲಿದೆ.", "hi": "वह अनुरोध अभी भी रुका हुआ है."}),
    ("Your request is already completed.",
     {"kn": "ನಿಮ್ಮ ವಿನಂತಿ ಈಗಾಗಲೇ ಪೂರ್ಣಗೊಂಡಿದೆ.", "hi": "आपका अनुरोध पहले ही पूरा हो चुका है."}),
    ("That request was cancelled.",
     {"kn": "ಆ ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಲಾಗಿದೆ.", "hi": "वह अनुरोध रद्द कर दिया गया था."}),

    # --- pause / resume / cancel / repeat
    ("Okay, I've paused this request.",
     {"kn": "ಸರಿ, ಈ ವಿನಂತಿಯನ್ನು ವಿರಾಮಗೊಳಿಸಿದ್ದೇನೆ.", "hi": "ठीक है, मैंने यह अनुरोध रोक दिया है."}),
    ("Let me know when you're ready to continue.",
     {"kn": "ಮುಂದುವರಿಸಲು ಸಿದ್ಧರಾದಾಗ ತಿಳಿಸಿ.", "hi": "जब आप आगे बढ़ने के लिए तैयार हों, तो बताइए."}),
    # The quoted word is one the control tier recognises as resume.
    ("Say resume when you'd like to continue.",
     {"kn": "ಮುಂದುವರಿಸಬೇಕೆಂದಾಗ 'ಮುಂದುವರಿಸಿ' ಎಂದು ಹೇಳಿ.", "hi": "जब आगे बढ़ना हो, तो 'जारी रखो' कहिए."}),
    ("Okay, I've cancelled that request.",
     {"kn": "ಸರಿ, ಆ ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿದ್ದೇನೆ.", "hi": "ठीक है, मैंने वह अनुरोध रद्द कर दिया है."}),
    ("There's nothing active to cancel right now.",
     {"kn": "ರದ್ದು ಮಾಡಲು ಈಗ ಏನೂ ಇಲ್ಲ.", "hi": "अभी रद्द करने के लिए कुछ नहीं है."}),
    ("There's nothing active to pause right now.",
     {"kn": "ವಿರಾಮಗೊಳಿಸಲು ಈಗ ಏನೂ ಇಲ್ಲ.", "hi": "अभी रोकने के लिए कुछ नहीं है."}),
    ("There's nothing to repeat right now.",
     {"kn": "ಈಗ ಪುನಃ ಹೇಳಲು ಏನೂ ಇಲ್ಲ.", "hi": "अभी दोहराने के लिए कुछ नहीं है."}),

    # --- offers and closings
    ("What banking service would you like help with?",
     {"kn": "ಯಾವ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆಗೆ ಸಹಾಯ ಬೇಕು?", "hi": "आपको किस बैंकिंग सेवा में मदद चाहिए?"}),
    ("Let me know which banking service you'd like help with.",
     {"kn": "ಯಾವ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆ ಬೇಕು ಎಂದು ತಿಳಿಸಿ.", "hi": "बताइए आपको कौन सी बैंकिंग सेवा चाहिए."}),
    ("Let me know if you'd like help with anything else.",
     {"kn": "ಬೇರೆ ಏನಾದರೂ ಸಹಾಯ ಬೇಕಿದ್ದರೆ ತಿಳಿಸಿ.", "hi": "किसी और चीज़ में मदद चाहिए तो बताइए."}),
    ("Let me know if you'd like help with something else.",
     {"kn": "ಬೇರೆ ಯಾವುದಕ್ಕಾದರೂ ಸಹಾಯ ಬೇಕಿದ್ದರೆ ತಿಳಿಸಿ.", "hi": "किसी और काम में मदद चाहिए तो बताइए."}),
    ("Would you like help with anything else?",
     {"kn": "ಬೇರೆ ಏನಾದರೂ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या आपको किसी और चीज़ में मदद चाहिए?"}),
    ("Thank you for using the banking assistant.",
     {"kn": "ಬ್ಯಾಂಕಿಂಗ್ ಸಹಾಯಕವನ್ನು ಬಳಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು.", "hi": "बैंकिंग सहायक का उपयोग करने के लिए धन्यवाद."}),

    # --- refusing and redirecting
    ("I can't help with that.", {"kn": "ಅದಕ್ಕೆ ನಾನು ಸಹಾಯ ಮಾಡಲಾರೆ.", "hi": "इसमें मैं मदद नहीं कर सकता."}),
    ("I can help you deposit money, withdraw money, check your balance, apply for a loan or open an account.",
     {"kn": "ಹಣ ಜಮಾ, ಹಣ ತೆಗೆಯುವುದು, ಬ್ಯಾಲೆನ್ಸ್ ಪರಿಶೀಲನೆ, ಸಾಲದ ಅರ್ಜಿ ಅಥವಾ ಹೊಸ ಖಾತೆ ತೆರೆಯಲು ಸಹಾಯ ಮಾಡಬಲ್ಲೆ.",
      "hi": "मैं पैसे जमा करने, निकालने, बैलेंस देखने, लोन के आवेदन या नया खाता खोलने में मदद कर सकता हूँ."}),
    ("Which would you like?", {"kn": "ಯಾವುದು ಬೇಕು?", "hi": "आपको क्या चाहिए?"}),

    # --- not catching the customer
    ("Sorry, I didn't catch that.",
     {"kn": "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅದು ಅರ್ಥವಾಗಲಿಲ್ಲ.", "hi": "क्षमा करें, मैं वह समझ नहीं पाया."}),
    ("Could you say that again?",
     {"kn": "ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ?", "hi": "क्या आप फिर से कह सकते हैं?"}),
    ("I did not catch that.", {"kn": "ನನಗೆ ಅದು ಅರ್ಥವಾಗಲಿಲ್ಲ.", "hi": "मैं वह समझ नहीं पाया."}),
    ("Could you say it again?",
     {"kn": "ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ?", "hi": "क्या आप इसे फिर से कह सकते हैं?"}),

    # --- temporary errors
    ("Sorry, I hit a temporary problem handling that.",
     {"kn": "ಕ್ಷಮಿಸಿ, ಅದನ್ನು ನಿರ್ವಹಿಸುವಾಗ ತಾತ್ಕಾಲಿಕ ಸಮಸ್ಯೆ ಉಂಟಾಯಿತು.",
      "hi": "क्षमा करें, इसे संभालते समय एक अस्थायी समस्या आई."}),
    ("Your request is still saved -- please say that again.",
     {"kn": "ನಿಮ್ಮ ವಿನಂತಿ ಇನ್ನೂ ಉಳಿದಿದೆ -- ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.",
      "hi": "आपका अनुरोध अभी भी सुरक्षित है -- कृपया फिर से कहिए."}),
    ("Sorry, I'm having trouble looking that up right now.",
     {"kn": "ಕ್ಷಮಿಸಿ, ಈಗ ಅದನ್ನು ಹುಡುಕುವಲ್ಲಿ ತೊಂದರೆಯಾಗುತ್ತಿದೆ.", "hi": "क्षमा करें, अभी इसे खोजने में दिक्कत हो रही है."}),
    ("Please try asking again in a moment.",
     {"kn": "ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಕೇಳಿ.", "hi": "कृपया थोड़ी देर बाद फिर से पूछिए."}),

    # --- services with no guided procedure
    ("I understood your request, but I don't have a guided procedure for that service yet.",
     {"kn": "ನಿಮ್ಮ ವಿನಂತಿ ಅರ್ಥವಾಯಿತು, ಆದರೆ ಆ ಸೇವೆಗೆ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ.",
      "hi": "मैं आपका अनुरोध समझ गया, लेकिन उस सेवा के लिए मेरे पास अभी कोई निर्देशित प्रक्रिया नहीं है."}),
    ("You can still ask me questions about it, or tell me another banking service you'd like help with.",
     {"kn": "ಆದರೂ ಅದರ ಬಗ್ಗೆ ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳಬಹುದು, ಅಥವಾ ನಿಮಗೆ ಬೇಕಾದ ಬೇರೆ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆಯನ್ನು ತಿಳಿಸಬಹುದು.",
      "hi": "आप फिर भी इसके बारे में सवाल पूछ सकते हैं, या कोई दूसरी बैंकिंग सेवा बता सकते हैं जिसमें आपको मदद चाहिए."}),
    ("I don't have a guided procedure for that service, so I can't read out its steps.",
     {"kn": "ಆ ಸೇವೆಗೆ ನನ್ನ ಬಳಿ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಅದರ ಹಂತಗಳನ್ನು ಓದಲು ಸಾಧ್ಯವಿಲ್ಲ.",
      "hi": "उस सेवा के लिए मेरे पास कोई निर्देशित प्रक्रिया नहीं है, इसलिए मैं उसके चरण नहीं पढ़ सकता."}),
    ("I understood you'd like help with {workflow}, but I don't have a guided procedure for that yet.",
     {"kn": "ನಿಮಗೆ {workflow} ಸೇವೆಯಲ್ಲಿ ಸಹಾಯ ಬೇಕು ಎಂದು ಅರ್ಥವಾಯಿತು, ಆದರೆ ಅದಕ್ಕೆ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ.",
      "hi": "मैं समझ गया कि आपको {workflow} सेवा में मदद चाहिए, लेकिन उसके लिए मेरे पास अभी कोई निर्देशित प्रक्रिया नहीं है."}),
    ("I don't have a guided procedure for {workflow} yet, so I've left your {workflow2} exactly as it was.",
     {"kn": "{workflow} ಸೇವೆಗೆ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಮಾರ್ಗದರ್ಶಿತ ಪ್ರಕ್ರಿಯೆ ಇಲ್ಲ, ಆದ್ದರಿಂದ ನಿಮ್ಮ {workflow2} ವಿನಂತಿಯನ್ನು ಇದ್ದಂತೆಯೇ ಬಿಟ್ಟಿದ್ದೇನೆ.",
      "hi": "{workflow} सेवा के लिए मेरे पास अभी कोई निर्देशित प्रक्रिया नहीं है, इसलिए मैंने आपका {workflow2} अनुरोध जैसा था वैसा ही छोड़ दिया है."}),
    ("Your {workflow} is still in progress.",
     {"kn": "ನಿಮ್ಮ {workflow} ವಿನಂತಿ ಇನ್ನೂ ಪ್ರಗತಿಯಲ್ಲಿದೆ.", "hi": "आपका {workflow} अनुरोध अभी भी जारी है."}),

    # --- workflow conflicts
    ("You currently have a {current} in progress.",
     {"kn": "ನಿಮ್ಮ {current} ವಿನಂತಿ ಈಗ ಪ್ರಗತಿಯಲ್ಲಿದೆ.", "hi": "आपका {current} अनुरोध अभी चल रहा है."}),
    ("Your {current} is currently paused.",
     {"kn": "ನಿಮ್ಮ {current} ವಿನಂತಿ ಈಗ ವಿರಾಮದಲ್ಲಿದೆ.", "hi": "आपका {current} अनुरोध अभी रुका हुआ है."}),
    ("Would you like to cancel the {current} and start a {requested}, pause the {current} and start a "
     "{requested}, or continue with the {current}?",
     {"kn": "{current} ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿ {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, {current} ವಿನಂತಿಯನ್ನು "
            "ವಿರಾಮಗೊಳಿಸಿ {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, ಅಥವಾ {current} ವಿನಂತಿಯನ್ನೇ ಮುಂದುವರಿಸಬೇಕೇ?",
      "hi": "क्या आप {current} अनुरोध रद्द करके {requested} अनुरोध शुरू करना चाहेंगे, {current} अनुरोध को "
            "विराम देकर {requested} अनुरोध शुरू करना चाहेंगे, या {current} अनुरोध ही जारी रखना चाहेंगे?"}),
    ("Would you like to cancel the {current} and start a {requested}, keep the {current} paused and start a "
     "{requested}, or continue with the {current}?",
     {"kn": "{current} ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿ {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, {current} ವಿನಂತಿಯನ್ನು "
            "ವಿರಾಮದಲ್ಲೇ ಇಟ್ಟು {requested} ವಿನಂತಿ ಆರಂಭಿಸಬೇಕೇ, ಅಥವಾ {current} ವಿನಂತಿಯನ್ನೇ ಮುಂದುವರಿಸಬೇಕೇ?",
      "hi": "क्या आप {current} अनुरोध रद्द करके {requested} अनुरोध शुरू करना चाहेंगे, {current} अनुरोध को "
            "विराम में रखकर {requested} अनुरोध शुरू करना चाहेंगे, या {current} अनुरोध ही जारी रखना चाहेंगे?"}),
    ("Okay, I've cancelled the {workflow}.",
     {"kn": "ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಿದ್ದೇನೆ.", "hi": "ठीक है, मैंने {workflow} अनुरोध रद्द कर दिया है."}),
    ("Okay, I've paused the {workflow} and you can come back to it later.",
     {"kn": "ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನು ವಿರಾಮಗೊಳಿಸಿದ್ದೇನೆ; ನಂತರ ಅದಕ್ಕೆ ಮರಳಬಹುದು.",
      "hi": "ठीक है, मैंने {workflow} अनुरोध रोक दिया है, आप बाद में इस पर लौट सकते हैं."}),
    ("Let's start the {workflow}.",
     {"kn": "{workflow} ವಿನಂತಿಯನ್ನು ಆರಂಭಿಸೋಣ.", "hi": "आइए {workflow} अनुरोध शुरू करें."}),
    ("Okay, let's continue with the {workflow}.",
     {"kn": "ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನು ಮುಂದುವರಿಸೋಣ.", "hi": "ठीक है, {workflow} अनुरोध जारी रखते हैं."}),
    ("Okay, we'll carry on with the {workflow}.",
     {"kn": "ಸರಿ, {workflow} ವಿನಂತಿಯನ್ನೇ ಮುಂದುವರಿಸುತ್ತೇವೆ.", "hi": "ठीक है, हम {workflow} अनुरोध ही जारी रखेंगे."}),

    # --- cancel confirmation. The quoted words are ones the engine
    # recognises as the two answers: ರದ್ದು / रद्द confirm, ಮುಂದುವರಿಸಿ /
    # जारी रखो keep the request.
    ("Do you want to cancel the {workflow}?",
     {"kn": "ನೀವು {workflow} ವಿನಂತಿಯನ್ನು ರದ್ದು ಮಾಡಲು ಬಯಸುವಿರಾ?",
      "hi": "क्या आप {workflow} अनुरोध रद्द करना चाहते हैं?"}),
    ("Say cancel to confirm, or continue to keep it.",
     {"kn": "ಖಚಿತಪಡಿಸಲು 'ರದ್ದು ಮಾಡಿ' ಎಂದು ಹೇಳಿ, ಅಥವಾ ಉಳಿಸಿಕೊಳ್ಳಲು 'ಮುಂದುವರಿಸಿ' ಎಂದು ಹೇಳಿ.",
      "hi": "पुष्टि के लिए 'रद्द करो' कहिए, या इसे बनाए रखने के लिए 'जारी रखो' कहिए."}),
    ("Okay, I won't cancel it.",
     {"kn": "ಸರಿ, ನಾನು ಅದನ್ನು ರದ್ದು ಮಾಡುವುದಿಲ್ಲ.", "hi": "ठीक है, मैं इसे रद्द नहीं करूँगा."}),

    # --- reading out steps
    ("Step {n}: {instruction}", {"kn": "ಹಂತ {n}: {instruction}", "hi": "चरण {n}: {instruction}"}),
    ("Step {n} of the {workflow} process is: {instruction}",
     {"kn": "{workflow} ಪ್ರಕ್ರಿಯೆಯ ಹಂತ {n}: {instruction}", "hi": "{workflow} प्रक्रिया का चरण {n}: {instruction}"}),
    ("That request only has {k} steps, so there's no step {n}.",
     {"kn": "ಆ ವಿನಂತಿಯಲ್ಲಿ {k} ಹಂತಗಳು ಮಾತ್ರ ಇವೆ, ಆದ್ದರಿಂದ ಹಂತ {n} ಇಲ್ಲ.",
      "hi": "उस अनुरोध में केवल {k} चरण हैं, इसलिए चरण {n} नहीं है."}),
    ("I couldn't tell which step you meant.",
     {"kn": "ನೀವು ಯಾವ ಹಂತವನ್ನು ಉದ್ದೇಶಿಸಿದ್ದೀರಿ ಎಂದು ನನಗೆ ತಿಳಿಯಲಿಲ್ಲ.",
      "hi": "मैं समझ नहीं पाया कि आप किस चरण की बात कर रहे हैं."}),
    ("You can say, for example, step 2.",
     {"kn": "ಉದಾಹರಣೆಗೆ, ಹಂತ 2 ಎಂದು ಹೇಳಬಹುದು.", "hi": "आप उदाहरण के लिए, चरण 2 कह सकते हैं."}),
    ("That step is not available in the current workflow.",
     {"kn": "ಈಗಿನ ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ ಆ ಹಂತ ಲಭ್ಯವಿಲ್ಲ.", "hi": "मौजूदा प्रक्रिया में वह चरण उपलब्ध नहीं है."}),
    ("Sorry, I can no longer access the steps for that request.",
     {"kn": "ಕ್ಷಮಿಸಿ, ಆ ವಿನಂತಿಯ ಹಂತಗಳು ಈಗ ನನಗೆ ಲಭ್ಯವಿಲ್ಲ.", "hi": "क्षमा करें, उस अनुरोध के चरण अब मेरे पास उपलब्ध नहीं हैं."}),

    # --- proactive offers of help (app/dialogue/assistance.PROMPTS)
    # AWAITING NATIVE-SPEAKER REVIEW, like every entry in this file. "Help"
    # is ಸಹಾಯ / मदद -- the words the control tier accepts as `help`.
    ("Take your time.", {"kn": "ನಿಧಾನವಾಗಿ ಮಾಡಿ.", "hi": "आराम से कीजिए."}),
    ("Just say help.", {"kn": "'ಸಹಾಯ' ಎಂದು ಹೇಳಿ.", "hi": "'मदद' कहिए."}),
    ("I can help if you need me.",
     {"kn": "ನಿಮಗೆ ಬೇಕಾದರೆ ನಾನು ಸಹಾಯ ಮಾಡಬಲ್ಲೆ.", "hi": "ज़रूरत हो तो मैं मदद कर सकता हूँ."}),
    ("Are you having difficulty entering the account number?",
     {"kn": "ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಲು ತೊಂದರೆಯಾಗುತ್ತಿದೆಯೇ?",
      "hi": "क्या खाता नंबर भरने में दिक्कत हो रही है?"}),
    ("Do you need help with the account number?",
     {"kn": "ಖಾತೆ ಸಂಖ್ಯೆಯ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या खाता नंबर के लिए मदद चाहिए?"}),
    ("Would you like me to explain how to enter the amount?",
     {"kn": "ಮೊತ್ತವನ್ನು ಹೇಗೆ ಬರೆಯಬೇಕು ಎಂದು ನಾನು ವಿವರಿಸಲೇ?",
      "hi": "क्या मैं समझाऊँ कि राशि कैसे लिखनी है?"}),
    ("Do you need help with the amount?",
     {"kn": "ಮೊತ್ತದ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या राशि के लिए मदद चाहिए?"}),
    ("Would you like help with the spelling or the information needed in this field?",
     {"kn": "ಈ ಭಾಗದಲ್ಲಿ ಕಾಗುಣಿತ ಅಥವಾ ಬೇಕಾದ ಮಾಹಿತಿಯ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?",
      "hi": "क्या इस खाने में वर्तनी या ज़रूरी जानकारी के लिए मदद चाहिए?"}),
    ("Do you need help with your name?",
     {"kn": "ನಿಮ್ಮ ಹೆಸರಿನ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या आपके नाम के लिए मदद चाहिए?"}),
    ("Would you like help with the date on this form?",
     {"kn": "ಈ ನಮೂನೆಯಲ್ಲಿನ ದಿನಾಂಕದ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या इस फ़ॉर्म में तारीख के लिए मदद चाहिए?"}),
    ("Do you need help with the date?",
     {"kn": "ದಿನಾಂಕದ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या तारीख के लिए मदद चाहिए?"}),
    ("Would you like help with where to sign?",
     {"kn": "ಎಲ್ಲಿ ಸಹಿ ಮಾಡಬೇಕು ಎಂಬುದರ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?",
      "hi": "क्या कहाँ हस्ताक्षर करना है, इसके लिए मदद चाहिए?"}),
    ("Do you need help with the signature?",
     {"kn": "ಸಹಿಯ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या हस्ताक्षर के लिए मदद चाहिए?"}),
    ("Would you like some assistance with this step?",
     {"kn": "ಈ ಹಂತದಲ್ಲಿ ನಿಮಗೆ ಸ್ವಲ್ಪ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या इस चरण में आपको कुछ मदद चाहिए?"}),
    ("Do you need help with this step?",
     {"kn": "ಈ ಹಂತದ ಬಗ್ಗೆ ಸಹಾಯ ಬೇಕೇ?", "hi": "क्या इस चरण के लिए मदद चाहिए?"}),

    # --- what `help` explains about the current field (assistance.FIELD_HELP)
    # AWAITING NATIVE-SPEAKER AND BANK REVIEW.
    ("Your account number is printed in your passbook.",
     {"kn": "ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆ ನಿಮ್ಮ ಪಾಸ್‌ಬುಕ್‌ನಲ್ಲಿ ಮುದ್ರಿತವಾಗಿದೆ.",
      "hi": "आपका खाता नंबर आपकी पासबुक में छपा होता है."}),
    ("Write it exactly as it appears there.",
     {"kn": "ಅದನ್ನು ಅಲ್ಲಿರುವಂತೆಯೇ ನಿಖರವಾಗಿ ಬರೆಯಿರಿ.", "hi": "इसे ठीक वैसा ही लिखिए जैसा वहाँ लिखा है."}),
    ("Write the amount in numbers, and also in words if the slip has a space for it.",
     {"kn": "ಮೊತ್ತವನ್ನು ಅಂಕಿಗಳಲ್ಲಿ ಬರೆಯಿರಿ, ಚೀಟಿಯಲ್ಲಿ ಸ್ಥಳವಿದ್ದರೆ ಅಕ್ಷರಗಳಲ್ಲಿಯೂ ಬರೆಯಿರಿ.",
      "hi": "राशि अंकों में लिखिए, और अगर पर्ची में जगह हो तो शब्दों में भी लिखिए."}),
    ("Write your name exactly as it appears in your bank records.",
     {"kn": "ನಿಮ್ಮ ಹೆಸರನ್ನು ಬ್ಯಾಂಕ್ ದಾಖಲೆಗಳಲ್ಲಿರುವಂತೆಯೇ ನಿಖರವಾಗಿ ಬರೆಯಿರಿ.",
      "hi": "अपना नाम ठीक वैसा ही लिखिए जैसा बैंक के रिकॉर्ड में है."}),
    ("Write today's date in the date field.",
     {"kn": "ದಿನಾಂಕದ ಸ್ಥಳದಲ್ಲಿ ಇಂದಿನ ದಿನಾಂಕವನ್ನು ಬರೆಯಿರಿ.", "hi": "तारीख वाले खाने में आज की तारीख लिखिए."}),
    ("Sign in the space marked for your signature, the same way you sign for your bank account.",
     {"kn": "ಸಹಿಗಾಗಿ ಗುರುತಿಸಿದ ಸ್ಥಳದಲ್ಲಿ, ನಿಮ್ಮ ಬ್ಯಾಂಕ್ ಖಾತೆಗೆ ಸಹಿ ಮಾಡುವ ರೀತಿಯಲ್ಲೇ ಸಹಿ ಮಾಡಿ.",
      "hi": "हस्ताक्षर के लिए तय जगह पर वैसे ही हस्ताक्षर कीजिए जैसे आप अपने बैंक खाते के लिए करते हैं."}),
    ("If anything on this step is unclear, the bank staff can also help you.",
     {"kn": "ಈ ಹಂತದಲ್ಲಿ ಏನಾದರೂ ಅಸ್ಪಷ್ಟವಾಗಿದ್ದರೆ, ಬ್ಯಾಂಕ್ ಸಿಬ್ಬಂದಿಯೂ ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಹುದು.",
      "hi": "अगर इस चरण में कुछ स्पष्ट न हो, तो बैंक कर्मचारी भी आपकी मदद कर सकते हैं."}),
]

#: The fallback marker. Placed before any part of a fixed reply that has no
#: rendering, so English is never presented as Kannada or Hindi silently.
UNTRANSLATED_MARKER = {
    "kn": "(ಈ ಭಾಗ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತ್ರ ಲಭ್ಯವಿದೆ:)",
    "hi": "(यह हिस्सा केवल अंग्रेज़ी में उपलब्ध है:)",
}
