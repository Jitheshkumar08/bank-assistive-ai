"""CampusGuide's fixed replies and topic names (domain integration, Phase 4).

Plain data. English is canonical (it is what conversation history keeps);
Kannada and Hindi are renderings applied at the output boundary by
app/dialogue/catalog_localizer.py.

REVIEW STATUS -- READ BEFORE RELYING ON THESE

Every Kannada and Hindi rendering below was AUTHORED by the development
assistant (not a native speaker) and has NOT been reviewed, exactly like the
Banking catalog (localization_catalog.py, REVIEW_STATUS = "unreviewed").

None of these sentences states an institutional fact. Facts only ever come
from retrieved, verified documents, through the grounded answerer.
"""

from app.dialogue.catalog_localizer import SentenceCatalog

# ------------------------------------------------------------------ sentences
NO_VERIFIED_INFO = "I don't have verified information about {topic} yet."
NO_VERIFIED_INFO_GENERIC = "I don't have verified information about that yet."
CONTACT_OFFICE = "Please contact the college office for help."
OUT_OF_SCOPE = "I can help only with questions about the college, such as admissions, fees, courses, hostel and transport."
UNSUPPORTED = "Sorry, I can't help with that."
ACKNOWLEDGED = "Okay. What would you like to know about the college?"
THANKS = "You're welcome. Is there anything else you would like to know?"
HELP = "You can ask me about admissions, documents, fees, scholarships, courses, exams, hostel, transport and contacts."
CLARIFY = "Do you mean {topic} or {topic2}?"
WORKFLOW_PENDING = "I can't check {topic} in the assistant yet."
USE_PORTAL = "Please use the CampusGuide portal for that."
NO_TASK = "There is no task in progress right now."
NOTHING_TO_REPEAT = "There is nothing to repeat yet."
FAREWELL = "Thank you for using CampusGuide."
APOLOGY = "Sorry, I hit a temporary problem. Please ask that again."
DID_NOT_CATCH = "I did not catch that. Could you say it again?"
NO_INSTITUTION = "Please scan the CampusGuide QR code for your college first."

# ---------------------------------------------- workflows (Phase 5) -- shared
STOPPED = "Okay, I've stopped {topic}."
PAUSED = "Okay, I've paused {topic}. Say resume to continue."
CONTINUE_HINT = "Say next to continue {topic}."
STEP_HINT = "Say next to continue, repeat to hear it again, or cancel to stop."
NOTHING_PAUSED = "There is nothing paused right now."

# ------------------------------------------------------ admission guidance
GUIDANCE_STEP_PROCESS = "First, the admission process."
GUIDANCE_STEP_DOCUMENTS = "Next, the documents you need."
GUIDANCE_STEP_ELIGIBILITY = "Next, eligibility."
GUIDANCE_STEP_NEXT = "Next, what to do now."
GUIDANCE_STEP_OFFICE = "Finally, where to get help."
GUIDANCE_SAY_NEXT = "Say next to continue with {topic}."
GUIDANCE_DONE = "That is the end of the admission guidance."

# --------------------------------------------------------- admission status
STATUS_CHECKING = "I'll check your admission status in CampusGuide."
STATUS_DETAILS = "Your admission details from the official records are shown below."
STATUS_SIGN_IN = "Please sign in to your CampusGuide account to see your admission status."
STATUS_NO_RECORD = "I couldn't find an admission record for the email address of your account."
STATUS_OTHER_EMAIL = "If you applied with a different email address, please contact the admission office."
STATUS_AMBIGUOUS = "More than one admission record matches your account, so I can't show one."
STATUS_ADMISSION_OFFICE = "Please contact the admission office."
STATUS_SCAN_AGAIN = "Please scan the CampusGuide QR code again to continue."
STATUS_UNAVAILABLE = "I can't check your admission status right now. Please try again later or open the Result page."
STATUS_STUDENTS_ONLY = "Admission status is available only to student accounts."
REFERENCE_WARNING = "For your security, I don't use reference numbers typed in the chat."

# --------------------------------------------------------- campus navigation
ASK_DESTINATION = "Where would you like to go?"
NO_CAMPUS_MAP = "I don't have verified campus directions for this college yet."
NO_CURRENT_LOCATION = "Please scan the CampusGuide QR code nearest to you, so I know where you are."
UNKNOWN_CURRENT_LOCATION = "I don't have verified directions from this QR code's location yet."
PLACE_NOT_FOUND = "I couldn't find that place in the verified campus map."
ASK_ANOTHER_PLACE = "Please tell me another place, or say cancel."
SAY_NEXT_STEP = "Say next for the next step."
LAST_STEP = "That was the last step."
#: Sentences whose slots hold campus DATA (place names, step numbers). Filled
#: with SentenceCatalog.fill(); never read back from text.
NO_ROUTE = "I don't have verified directions from {place} to {place2} yet."
ALREADY_THERE = "You are already at {place}."
DIRECTIONS_INTRO = "Here are the directions from {place} to {place2}."
STEP_OF = "Step {n} of {k}:"
CLARIFY_PLACE = "Do you mean {place} or {place2}?"

SENTENCES = (
    (NO_VERIFIED_INFO, {
        "kn": "{topic} ಕುರಿತು ನನ್ನ ಬಳಿ ಇನ್ನೂ ಪರಿಶೀಲಿತ ಮಾಹಿತಿ ಇಲ್ಲ.",
        "hi": "{topic} के बारे में मेरे पास अभी सत्यापित जानकारी नहीं है.",
    }),
    (NO_VERIFIED_INFO_GENERIC, {
        "kn": "ಅದರ ಕುರಿತು ನನ್ನ ಬಳಿ ಇನ್ನೂ ಪರಿಶೀಲಿತ ಮಾಹಿತಿ ಇಲ್ಲ.",
        "hi": "इसके बारे में मेरे पास अभी सत्यापित जानकारी नहीं है.",
    }),
    (CONTACT_OFFICE, {
        "kn": "ಸಹಾಯಕ್ಕಾಗಿ ದಯವಿಟ್ಟು ಕಾಲೇಜು ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
        "hi": "मदद के लिए कृपया कॉलेज कार्यालय से संपर्क करें.",
    }),
    (OUT_OF_SCOPE, {
        "kn": "ನಾನು ಕಾಲೇಜಿಗೆ ಸಂಬಂಧಿಸಿದ ಪ್ರಶ್ನೆಗಳಿಗೆ ಮಾತ್ರ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ, ಉದಾಹರಣೆಗೆ ಪ್ರವೇಶ, ಶುಲ್ಕ, ಕೋರ್ಸ್‌ಗಳು, ಹಾಸ್ಟೆಲ್ ಮತ್ತು ಸಾರಿಗೆ.",
        "hi": "मैं केवल कॉलेज से जुड़े सवालों में मदद कर सकता हूँ, जैसे प्रवेश, फीस, कोर्स, हॉस्टल और परिवहन.",
    }),
    (UNSUPPORTED, {
        "kn": "ಕ್ಷಮಿಸಿ, ಅದರಲ್ಲಿ ನಾನು ಸಹಾಯ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.",
        "hi": "माफ़ कीजिए, मैं इसमें मदद नहीं कर सकता.",
    }),
    (ACKNOWLEDGED, {
        "kn": "ಸರಿ. ಕಾಲೇಜಿನ ಬಗ್ಗೆ ನಿಮಗೆ ಏನು ತಿಳಿಯಬೇಕು?",
        "hi": "ठीक है. आप कॉलेज के बारे में क्या जानना चाहेंगे?",
    }),
    (THANKS, {
        "kn": "ಸ್ವಾಗತ. ಇನ್ನೇನಾದರೂ ತಿಳಿಯಬೇಕೇ?",
        "hi": "आपका स्वागत है. क्या आप कुछ और जानना चाहेंगे?",
    }),
    (HELP, {
        "kn": "ಪ್ರವೇಶ, ದಾಖಲೆಗಳು, ಶುಲ್ಕ, ವಿದ್ಯಾರ್ಥಿವೇತನ, ಕೋರ್ಸ್‌ಗಳು, ಪರೀಕ್ಷೆಗಳು, ಹಾಸ್ಟೆಲ್, ಸಾರಿಗೆ ಮತ್ತು ಸಂಪರ್ಕದ ಬಗ್ಗೆ ನೀವು ನನ್ನನ್ನು ಕೇಳಬಹುದು.",
        "hi": "आप मुझसे प्रवेश, दस्तावेज़, फीस, छात्रवृत्ति, कोर्स, परीक्षा, हॉस्टल, परिवहन और संपर्क के बारे में पूछ सकते हैं.",
    }),
    (CLARIFY, {
        "kn": "ನೀವು {topic} ಬಗ್ಗೆ ಕೇಳುತ್ತಿದ್ದೀರಾ ಅಥವಾ {topic2} ಬಗ್ಗೆ?",
        "hi": "क्या आप {topic} के बारे में पूछ रहे हैं या {topic2} के बारे में?",
    }),
    (WORKFLOW_PENDING, {
        "kn": "ಸಹಾಯಕದಲ್ಲಿ {topic} ಇನ್ನೂ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.",
        "hi": "सहायक में अभी {topic} की जाँच नहीं हो सकती.",
    }),
    (USE_PORTAL, {
        "kn": "ಅದಕ್ಕಾಗಿ ದಯವಿಟ್ಟು CampusGuide ಪೋರ್ಟಲ್ ಬಳಸಿ.",
        "hi": "इसके लिए कृपया CampusGuide पोर्टल का उपयोग करें.",
    }),
    (NO_TASK, {
        "kn": "ಈಗ ಯಾವುದೇ ಕಾರ್ಯ ನಡೆಯುತ್ತಿಲ್ಲ.",
        "hi": "अभी कोई कार्य चल नहीं रहा है.",
    }),
    (NOTHING_TO_REPEAT, {
        "kn": "ಮತ್ತೆ ಹೇಳಲು ಇನ್ನೂ ಏನೂ ಇಲ್ಲ.",
        "hi": "दोहराने के लिए अभी कुछ नहीं है.",
    }),
    (FAREWELL, {
        "kn": "CampusGuide ಬಳಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು.",
        "hi": "CampusGuide का उपयोग करने के लिए धन्यवाद.",
    }),
    (APOLOGY, {
        "kn": "ಕ್ಷಮಿಸಿ, ತಾತ್ಕಾಲಿಕ ತೊಂದರೆ ಆಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕೇಳಿ.",
        "hi": "माफ़ कीजिए, एक अस्थायी समस्या हुई. कृपया फिर से पूछें.",
    }),
    (DID_NOT_CATCH, {
        "kn": "ನನಗೆ ಅದು ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ?",
        "hi": "मैं समझ नहीं पाया. क्या आप फिर से कह सकते हैं?",
    }),
    (NO_INSTITUTION, {
        "kn": "ದಯವಿಟ್ಟು ಮೊದಲು ನಿಮ್ಮ ಕಾಲೇಜಿನ CampusGuide QR ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.",
        "hi": "कृपया पहले अपने कॉलेज का CampusGuide QR कोड स्कैन करें.",
    }),
    # ---------------------------------------------------------- Phase 5
    (STOPPED, {
        "kn": "ಸರಿ, {topic} ನಿಲ್ಲಿಸಿದ್ದೇನೆ.",
        "hi": "ठीक है, मैंने {topic} रोक दिया है.",
    }),
    (PAUSED, {
        "kn": "ಸರಿ, {topic} ತಡೆಹಿಡಿದಿದ್ದೇನೆ. ಮುಂದುವರಿಸಲು ಮುಂದುವರಿಸಿ ಎಂದು ಹೇಳಿ.",
        "hi": "ठीक है, मैंने {topic} रोक कर रखा है. जारी रखने के लिए जारी रखिए कहें.",
    }),
    (CONTINUE_HINT, {
        "kn": "{topic} ಮುಂದುವರಿಸಲು ಮುಂದಿನದು ಎಂದು ಹೇಳಿ.",
        "hi": "{topic} जारी रखने के लिए अगला कहें.",
    }),
    (STEP_HINT, {
        "kn": "ಮುಂದುವರಿಸಲು ಮುಂದಿನದು, ಮತ್ತೆ ಕೇಳಲು ಮತ್ತೆ ಹೇಳಿ, ನಿಲ್ಲಿಸಲು ನಿಲ್ಲಿಸಿ ಎಂದು ಹೇಳಿ.",
        "hi": "जारी रखने के लिए अगला, फिर से सुनने के लिए दोहराइए, या रोकने के लिए रद्द करो कहें.",
    }),
    (NOTHING_PAUSED, {
        "kn": "ಈಗ ಯಾವುದೂ ತಡೆಹಿಡಿಯಲ್ಪಟ್ಟಿಲ್ಲ.",
        "hi": "अभी कुछ भी रुका हुआ नहीं है.",
    }),
    (GUIDANCE_STEP_PROCESS, {
        "kn": "ಮೊದಲು, ಪ್ರವೇಶ ಪ್ರಕ್ರಿಯೆ.",
        "hi": "सबसे पहले, प्रवेश प्रक्रिया.",
    }),
    (GUIDANCE_STEP_DOCUMENTS, {
        "kn": "ಮುಂದೆ, ನಿಮಗೆ ಬೇಕಾದ ದಾಖಲೆಗಳು.",
        "hi": "आगे, ज़रूरी दस्तावेज़.",
    }),
    (GUIDANCE_STEP_ELIGIBILITY, {
        "kn": "ಮುಂದೆ, ಅರ್ಹತೆ.",
        "hi": "आगे, पात्रता.",
    }),
    (GUIDANCE_STEP_NEXT, {
        "kn": "ಮುಂದೆ, ಈಗ ಏನು ಮಾಡಬೇಕು.",
        "hi": "आगे, अब क्या करना है.",
    }),
    (GUIDANCE_STEP_OFFICE, {
        "kn": "ಕೊನೆಯದಾಗಿ, ಸಹಾಯ ಎಲ್ಲಿ ಸಿಗುತ್ತದೆ.",
        "hi": "आख़िर में, मदद कहाँ मिलेगी.",
    }),
    (GUIDANCE_SAY_NEXT, {
        "kn": "{topic} ಕುರಿತು ಮುಂದುವರಿಸಲು ಮುಂದಿನದು ಎಂದು ಹೇಳಿ.",
        "hi": "{topic} के बारे में जारी रखने के लिए अगला कहें.",
    }),
    (GUIDANCE_DONE, {
        "kn": "ಪ್ರವೇಶ ಮಾರ್ಗದರ್ಶನ ಇಲ್ಲಿಗೆ ಮುಗಿಯಿತು.",
        "hi": "प्रवेश मार्गदर्शन यहीं पूरा होता है.",
    }),
    (STATUS_CHECKING, {
        "kn": "CampusGuide ನಲ್ಲಿ ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿಯನ್ನು ಪರಿಶೀಲಿಸುತ್ತೇನೆ.",
        "hi": "मैं CampusGuide में आपके प्रवेश की स्थिति देखता हूँ.",
    }),
    (STATUS_DETAILS, {
        "kn": "ಅಧಿಕೃತ ದಾಖಲೆಗಳಿಂದ ನಿಮ್ಮ ಪ್ರವೇಶ ವಿವರಗಳನ್ನು ಕೆಳಗೆ ತೋರಿಸಲಾಗಿದೆ.",
        "hi": "आधिकारिक रिकॉर्ड से आपके प्रवेश का विवरण नीचे दिखाया गया है.",
    }),
    (STATUS_SIGN_IN, {
        "kn": "ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ನೋಡಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ CampusGuide ಖಾತೆಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.",
        "hi": "अपने प्रवेश की स्थिति देखने के लिए कृपया अपने CampusGuide खाते में साइन इन करें.",
    }),
    (STATUS_NO_RECORD, {
        "kn": "ನಿಮ್ಮ ಖಾತೆಯ ಇಮೇಲ್ ವಿಳಾಸಕ್ಕೆ ಹೊಂದುವ ಪ್ರವೇಶ ದಾಖಲೆ ನನಗೆ ಸಿಗಲಿಲ್ಲ.",
        "hi": "आपके खाते के ईमेल पते से मेल खाता कोई प्रवेश रिकॉर्ड मुझे नहीं मिला.",
    }),
    (STATUS_OTHER_EMAIL, {
        "kn": "ನೀವು ಬೇರೆ ಇಮೇಲ್ ವಿಳಾಸದಿಂದ ಅರ್ಜಿ ಸಲ್ಲಿಸಿದ್ದರೆ, ದಯವಿಟ್ಟು ಪ್ರವೇಶ ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
        "hi": "अगर आपने किसी दूसरे ईमेल पते से आवेदन किया था, तो कृपया प्रवेश कार्यालय से संपर्क करें.",
    }),
    (STATUS_AMBIGUOUS, {
        "kn": "ನಿಮ್ಮ ಖಾತೆಗೆ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ಪ್ರವೇಶ ದಾಖಲೆಗಳು ಹೊಂದುತ್ತವೆ, ಆದ್ದರಿಂದ ಯಾವುದನ್ನೂ ತೋರಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.",
        "hi": "आपके खाते से एक से अधिक प्रवेश रिकॉर्ड मेल खाते हैं, इसलिए मैं कोई भी नहीं दिखा सकता.",
    }),
    (STATUS_ADMISSION_OFFICE, {
        "kn": "ದಯವಿಟ್ಟು ಪ್ರವೇಶ ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
        "hi": "कृपया प्रवेश कार्यालय से संपर्क करें.",
    }),
    (STATUS_SCAN_AGAIN, {
        "kn": "ಮುಂದುವರಿಸಲು ದಯವಿಟ್ಟು CampusGuide QR ಕೋಡ್ ಅನ್ನು ಮತ್ತೆ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.",
        "hi": "जारी रखने के लिए कृपया CampusGuide QR कोड फिर से स्कैन करें.",
    }),
    (STATUS_UNAVAILABLE, {
        "kn": "ಈಗ ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ನಂತರ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಫಲಿತಾಂಶ ಪುಟವನ್ನು ತೆರೆಯಿರಿ.",
        "hi": "अभी आपके प्रवेश की स्थिति नहीं देखी जा सकती. कृपया बाद में फिर कोशिश करें या परिणाम पेज खोलें.",
    }),
    (STATUS_STUDENTS_ONLY, {
        "kn": "ಪ್ರವೇಶದ ಸ್ಥಿತಿ ವಿದ್ಯಾರ್ಥಿ ಖಾತೆಗಳಿಗೆ ಮಾತ್ರ ಲಭ್ಯವಿದೆ.",
        "hi": "प्रवेश की स्थिति केवल छात्र खातों के लिए उपलब्ध है.",
    }),
    (REFERENCE_WARNING, {
        "kn": "ನಿಮ್ಮ ಸುರಕ್ಷತೆಗಾಗಿ, ಚಾಟ್‌ನಲ್ಲಿ ಟೈಪ್ ಮಾಡಿದ ರೆಫರೆನ್ಸ್ ಸಂಖ್ಯೆಗಳನ್ನು ನಾನು ಬಳಸುವುದಿಲ್ಲ.",
        "hi": "आपकी सुरक्षा के लिए, मैं चैट में लिखे गए रेफ़रेंस नंबर का उपयोग नहीं करता.",
    }),
    (ASK_DESTINATION, {
        "kn": "ನೀವು ಎಲ್ಲಿಗೆ ಹೋಗಬೇಕು?",
        "hi": "आप कहाँ जाना चाहेंगे?",
    }),
    (NO_CAMPUS_MAP, {
        "kn": "ಈ ಕಾಲೇಜಿನ ಪರಿಶೀಲಿತ ಕ್ಯಾಂಪಸ್ ದಾರಿ ಮಾಹಿತಿ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲ.",
        "hi": "इस कॉलेज के कैंपस के सत्यापित रास्ते मेरे पास अभी नहीं हैं.",
    }),
    (NO_CURRENT_LOCATION, {
        "kn": "ನೀವು ಎಲ್ಲಿದ್ದೀರಿ ಎಂದು ತಿಳಿಯಲು, ದಯವಿಟ್ಟು ನಿಮ್ಮ ಹತ್ತಿರದ CampusGuide QR ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.",
        "hi": "आप कहाँ हैं यह जानने के लिए, कृपया अपने पास का CampusGuide QR कोड स्कैन करें.",
    }),
    (UNKNOWN_CURRENT_LOCATION, {
        "kn": "ಈ QR ಕೋಡ್ ಇರುವ ಸ್ಥಳದಿಂದ ಪರಿಶೀಲಿತ ದಾರಿ ಮಾಹಿತಿ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲ.",
        "hi": "इस QR कोड की जगह से सत्यापित रास्ता मेरे पास अभी नहीं है.",
    }),
    (PLACE_NOT_FOUND, {
        "kn": "ಪರಿಶೀಲಿತ ಕ್ಯಾಂಪಸ್ ನಕ್ಷೆಯಲ್ಲಿ ಆ ಸ್ಥಳ ನನಗೆ ಸಿಗಲಿಲ್ಲ.",
        "hi": "सत्यापित कैंपस नक्शे में मुझे वह जगह नहीं मिली.",
    }),
    (ASK_ANOTHER_PLACE, {
        "kn": "ದಯವಿಟ್ಟು ಬೇರೆ ಸ್ಥಳ ಹೇಳಿ, ಅಥವಾ ನಿಲ್ಲಿಸಿ ಎಂದು ಹೇಳಿ.",
        "hi": "कृपया कोई दूसरी जगह बताइए, या रद्द करो कहिए.",
    }),
    (SAY_NEXT_STEP, {
        "kn": "ಮುಂದಿನ ಹಂತಕ್ಕೆ ಮುಂದಿನದು ಎಂದು ಹೇಳಿ.",
        "hi": "अगले चरण के लिए अगला कहें.",
    }),
    (LAST_STEP, {
        "kn": "ಅದು ಕೊನೆಯ ಹಂತ.",
        "hi": "यह आख़िरी चरण था.",
    }),
    (NO_ROUTE, {
        "kn": "{place} ನಿಂದ {place2} ಗೆ ಪರಿಶೀಲಿತ ದಾರಿ ಮಾಹಿತಿ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲ.",
        "hi": "{place} से {place2} तक का सत्यापित रास्ता मेरे पास अभी नहीं है.",
    }),
    (ALREADY_THERE, {
        "kn": "ನೀವು ಈಗಾಗಲೇ {place} ನಲ್ಲಿದ್ದೀರಿ.",
        "hi": "आप पहले से ही {place} पर हैं.",
    }),
    (DIRECTIONS_INTRO, {
        "kn": "{place} ನಿಂದ {place2} ಗೆ ಹೋಗುವ ದಾರಿ ಇಲ್ಲಿದೆ.",
        "hi": "{place} से {place2} तक जाने का रास्ता यह है.",
    }),
    (STEP_OF, {
        "kn": "ಹಂತ {n} / {k}:",
        "hi": "चरण {n} / {k}:",
    }),
    (CLARIFY_PLACE, {
        "kn": "ನೀವು {place} ಎನ್ನುತ್ತಿದ್ದೀರಾ ಅಥವಾ {place2}?",
        "hi": "क्या आपका मतलब {place} है या {place2}?",
    }),
)

# --------------------------------------------------------------- topic names
#: Intent -> how it is named in a reply (English is the slot value).
TOPIC_BY_INTENT = {
    "admission_process": "the admission process",
    "admission_documents": "admission documents",
    "admission_eligibility": "admission eligibility",
    "admission_status": "your admission status",
    "fee_information": "fees",
    "payment_process": "fee payment",
    "scholarship_information": "scholarships",
    "course_information": "courses",
    "department_information": "departments",
    "academic_calendar": "the academic calendar",
    "examination_information": "examinations",
    "hostel_information": "the hostel",
    "transport_information": "transport",
    "student_services": "student services",
    "contact_information": "contact details",
    "campus_navigation": "campus directions",
    "office_location": "office locations",
    "general_college_query": "the college",
}

TOPICS = {
    "the admission process": {"kn": "ಪ್ರವೇಶ ಪ್ರಕ್ರಿಯೆ", "hi": "प्रवेश प्रक्रिया"},
    "admission documents": {"kn": "ಪ್ರವೇಶ ದಾಖಲೆಗಳು", "hi": "प्रवेश दस्तावेज़"},
    "admission eligibility": {"kn": "ಪ್ರವೇಶ ಅರ್ಹತೆ", "hi": "प्रवेश पात्रता"},
    "your admission status": {"kn": "ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿ", "hi": "आपके प्रवेश की स्थिति"},
    "fees": {"kn": "ಶುಲ್ಕ", "hi": "फीस"},
    "fee payment": {"kn": "ಶುಲ್ಕ ಪಾವತಿ", "hi": "फीस भुगतान"},
    "scholarships": {"kn": "ವಿದ್ಯಾರ್ಥಿವೇತನ", "hi": "छात्रवृत्ति"},
    "courses": {"kn": "ಕೋರ್ಸ್‌ಗಳು", "hi": "कोर्स"},
    "departments": {"kn": "ವಿಭಾಗಗಳು", "hi": "विभाग"},
    "the academic calendar": {"kn": "ಶೈಕ್ಷಣಿಕ ವೇಳಾಪಟ್ಟಿ", "hi": "शैक्षणिक कैलेंडर"},
    "examinations": {"kn": "ಪರೀಕ್ಷೆಗಳು", "hi": "परीक्षाएँ"},
    "the hostel": {"kn": "ಹಾಸ್ಟೆಲ್", "hi": "हॉस्टल"},
    "transport": {"kn": "ಸಾರಿಗೆ", "hi": "परिवहन"},
    "student services": {"kn": "ವಿದ್ಯಾರ್ಥಿ ಸೇವೆಗಳು", "hi": "छात्र सेवाएँ"},
    "contact details": {"kn": "ಸಂಪರ್ಕ ವಿವರಗಳು", "hi": "संपर्क विवरण"},
    "campus directions": {"kn": "ಕ್ಯಾಂಪಸ್ ದಾರಿ", "hi": "कैंपस का रास्ता"},
    "office locations": {"kn": "ಕಚೇರಿಗಳ ಸ್ಥಳ", "hi": "कार्यालयों का स्थान"},
    "the college": {"kn": "ಕಾಲೇಜು", "hi": "कॉलेज"},
    # Phase 5: workflows and their steps.
    "the admission guidance": {"kn": "ಪ್ರವೇಶ ಮಾರ್ಗದರ್ಶನ", "hi": "प्रवेश मार्गदर्शन"},
    "the directions": {"kn": "ದಾರಿ ಮಾರ್ಗದರ್ಶನ", "hi": "रास्ते का मार्गदर्शन"},
    "the admission status check": {"kn": "ಪ್ರವೇಶ ಸ್ಥಿತಿಯ ಪರಿಶೀಲನೆ", "hi": "प्रवेश स्थिति की जाँच"},
    "the documents you need": {"kn": "ನಿಮಗೆ ಬೇಕಾದ ದಾಖಲೆಗಳು", "hi": "ज़रूरी दस्तावेज़"},
    "eligibility": {"kn": "ಅರ್ಹತೆ", "hi": "पात्रता"},
    "what to do now": {"kn": "ಈಗ ಏನು ಮಾಡಬೇಕು", "hi": "अब क्या करना है"},
    "where to get help": {"kn": "ಸಹಾಯ ಎಲ್ಲಿ ಸಿಗುತ್ತದೆ", "hi": "मदद कहाँ मिलेगी"},
}

COLLEGE_CATALOG = SentenceCatalog(sentences=SENTENCES, topics=TOPICS)

#: Persona for the grounded answerer. Describes behaviour, never facts.
PERSONA = "You are CampusGuide, a concise and factual assistant for students of one college."
