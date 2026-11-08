"""The College intent catalogue (domain integration, Phase 4).

Plain data for app/intent/profile.py. Each intent says WHAT a student is
asking about -- its group, the knowledge categories that answer it, or the
workflow that handles it -- and never what to reply.

REVIEW STATUS

English and Kannada example phrasings and keywords were AUTHORED by the
development assistant (not a native Kannada speaker) and have NOT been
reviewed, exactly like the Banking renderings in localization_catalog.py.
Hindi is not covered by examples: Hindi College questions rely on the
multilingual encoder alone.

TULU

Tulu (tcy) is not supported. The intended path is Tulu speech/text via
Kannada (the Kannada examples and keywords below would then apply); it stays
unimplemented until a verified Tulu ASR and translation path exists.

THRESHOLDS AND WHAT THEY WERE CHOSEN ON

  MARGIN = -0.05            dev set (debugging/fixtures/college_intents/dev.json):
                            true intents >= +0.030, non-intents <= -0.140.
  MARGIN_WITHOUT_EVIDENCE   Banking sets multilingual_v1 + m10_dev + m4_heldout:
    = 0.10                  every Banking sentence the College detector accepted
                            named no College keyword and scored +0.007..+0.088;
                            true College intents without a keyword: +0.137, +0.465
                            (only two such cases -- thin evidence).
  out_of_scope_gate         the same Banking sets: Banking's own lexical tables
                            (service_keywords, routing_safety) name the other
                            domain's services deterministically.
  AMBIGUITY_GAP = 0.02      dev set.

Checked on data NOT used for any choice above: the College held-out set
(heldout.json) and the Banking sets m3_language_cues, m5_fresh, m7_fresh.
Measured (docs/domain-integration/04-college-intents-runtime.md): dev 45/45,
held-out 40/43, untouched Banking sentences accepted as College 1/212.
"""

from app.dialogue.text_normalization import normalize_turn
from app.intent.intent_examples import NON_BANKING_ANCHORS, BANKING_INTENT_EXAMPLES
from app.intent.routing_safety import declined_regardless_cues, unsupported_operation_cues
from app.intent.service_keywords import service_evidence
from app.intent.profile import OUT_OF_SCOPE, IntentProfile, IntentSpec

ADMISSIONS, FEES, ACADEMICS, SERVICES, CAMPUS = "admissions", "fees", "academics", "student_services", "campus"


def _intent(name, group, categories, examples, keywords, handler="knowledge"):
    return IntentSpec(name=name, group=group, categories=frozenset(categories), handler=handler,
                      examples=tuple(examples), keywords=tuple(keywords))


INTENTS = (
    # ------------------------------------------------------------ admissions
    _intent("admission_process", ADMISSIONS, {"admission_process", "application_deadlines"}, [
        "what is the admission process",
        "how do i get admission to this college",
        "how do i apply for admission",
        "what are the steps to join the college",
        "what happens after seat allotment",
        "what is the last date to apply",
        "ಪ್ರವೇಶ ಪ್ರಕ್ರಿಯೆ ಏನು",
        "ಕಾಲೇಜಿಗೆ ಪ್ರವೇಶ ಪಡೆಯುವುದು ಹೇಗೆ",
        "ಅರ್ಜಿ ಸಲ್ಲಿಸುವುದು ಹೇಗೆ",
        "ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಕೊನೆಯ ದಿನಾಂಕ ಯಾವುದು",
    ], ["admission", "admissions", "admitted", "apply", "application", "deadline", "allotment", "counselling",
        "procedure", "process", "steps", "joining",
        "ಪ್ರವೇಶ", "ಅರ್ಜಿ", "ದಾಖಲಾತಿ"],
        # Phase 5: answered as the first step of the admission guidance
        # workflow (the same categories), which can then go on to documents,
        # eligibility, the next step and where to get help.
        handler="workflow:admission_guidance"),
    _intent("admission_documents", ADMISSIONS, {"admission_documents"}, [
        "what documents are required for admission",
        "which certificates should i bring for admission",
        "what papers do i need when i join",
        "do i need my transfer certificate",
        "list of documents for admission",
        "ಪ್ರವೇಶಕ್ಕೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು",
        "ಯಾವ ಪ್ರಮಾಣಪತ್ರಗಳನ್ನು ತರಬೇಕು",
        "ದಾಖಲೆಗಳ ಪಟ್ಟಿ ಹೇಳಿ",
    ], ["document", "documents", "certificate", "certificates", "papers", "marks card", "marksheet",
        "ದಾಖಲೆ", "ಪ್ರಮಾಣಪತ್ರ", "ಅಂಕಪಟ್ಟಿ"]),
    _intent("admission_eligibility", ADMISSIONS, {"admission_eligibility"}, [
        "am i eligible for admission",
        "what is the eligibility for engineering",
        "what marks do i need to get in",
        "what is the minimum percentage required",
        "who can apply for this course",
        "ಪ್ರವೇಶಕ್ಕೆ ಅರ್ಹತೆ ಏನು",
        "ನಾನು ಅರ್ಹನೇ",
        "ಕನಿಷ್ಠ ಅಂಕಗಳು ಎಷ್ಟು ಬೇಕು",
    ], ["eligible", "eligibility", "qualify", "minimum marks", "percentage", "cutoff", "cut-off",
        "ಅರ್ಹತೆ", "ಅರ್ಹ", "ಕನಿಷ್ಠ"]),
    _intent("admission_status", ADMISSIONS, frozenset(), [
        "what is my admission status",
        "has my admission been confirmed",
        "did i get a seat",
        "check my admission result",
        "which branch was i allotted",
        # Phase 6: the student's own rank / batch / admission hall are record
        # fields answered by the College backend, not campus directions.
        "what is my rank",
        "which batch am i in",
        "which admission hall should i go to",
        "ನನ್ನ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ಏನು",
        "ನನಗೆ ಸೀಟು ಸಿಕ್ಕಿದೆಯೇ",
        "ನನ್ನ ಫಲಿತಾಂಶ ನೋಡಬೇಕು",
    ], ["status", "my result", "my admission", "my seat", "allotted", "confirmed",
        "my rank", "my batch", "my hall", "admission hall", "assigned hall",
        "ಸ್ಥಿತಿ", "ಫಲಿತಾಂಶ", "ಸೀಟು"], handler="workflow:admission_status"),

    # ------------------------------------------------------------ fees
    _intent("fee_information", FEES, {"fees"}, [
        "what is the fee structure",
        "how much is the tuition fee",
        "what are the fees for computer science",
        "how much does the course cost",
        "what is the annual fee",
        "ಶುಲ್ಕ ಎಷ್ಟು",
        "ಕೋರ್ಸಿನ ಶುಲ್ಕ ಎಷ್ಟು",
        "ವಾರ್ಷಿಕ ಶುಲ್ಕ ಎಷ್ಟು",
    ], ["fee", "fees", "tuition", "cost", "charges", "ಶುಲ್ಕ", "ಫೀಸ್", "ಫೀ"]),
    _intent("payment_process", FEES, {"fees"}, [
        "how do i pay the fees",
        "can i pay the fee online",
        "where do i pay the fees",
        "can i pay in instalments",
        "what are the payment options",
        "ಶುಲ್ಕವನ್ನು ಹೇಗೆ ಪಾವತಿಸುವುದು",
        "ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಪಾವತಿಸಬಹುದೇ",
        "ಎಲ್ಲಿ ಹಣ ಕಟ್ಟಬೇಕು",
    ], ["pay", "payment", "instalment", "installment", "online payment", "receipt",
        "ಪಾವತಿ", "ಕಟ್ಟಬೇಕು", "ಕಟ್ಟುವುದು"]),
    _intent("scholarship_information", FEES, {"scholarships"}, [
        "are scholarships available",
        "how do i apply for a scholarship",
        "is there any fee concession",
        "what scholarships can i get",
        "ವಿದ್ಯಾರ್ಥಿವೇತನ ಸಿಗುತ್ತದೆಯೇ",
        "ವಿದ್ಯಾರ್ಥಿವೇತನಕ್ಕೆ ಅರ್ಜಿ ಹೇಗೆ",
        "ಶುಲ್ಕ ರಿಯಾಯಿತಿ ಇದೆಯೇ",
    ], ["scholarship", "scholarships", "concession", "waiver", "financial aid",
        "ವಿದ್ಯಾರ್ಥಿವೇತನ", "ರಿಯಾಯಿತಿ", "ಸ್ಕಾಲರ್"]),

    # ------------------------------------------------------------ academics
    _intent("course_information", ACADEMICS, {"programmes"}, [
        "which courses does the college offer",
        "what programmes are available",
        "tell me about the computer science course",
        "how many years is the degree",
        "is there a masters programme",
        "ಯಾವ ಕೋರ್ಸುಗಳು ಇವೆ",
        "ಯಾವ ಪದವಿ ಕಾರ್ಯಕ್ರಮಗಳು ಲಭ್ಯವಿವೆ",
        "ಎಂಜಿನಿಯರಿಂಗ್ ಕೋರ್ಸ್ ಬಗ್ಗೆ ಹೇಳಿ",
    ], ["course", "courses", "programme", "programmes", "program", "programs", "degree", "btech", "mtech",
        "branch", "branches", "ಕೋರ್ಸ್", "ಕೋರ್ಸು", "ಪದವಿ", "ಕಾರ್ಯಕ್ರಮ"]),
    _intent("department_information", ACADEMICS, {"departments"}, [
        "tell me about the mechanical department",
        "who is the head of the department",
        "which departments are there",
        "what labs does the department have",
        "ವಿಭಾಗದ ಬಗ್ಗೆ ಹೇಳಿ",
        "ವಿಭಾಗದ ಮುಖ್ಯಸ್ಥರು ಯಾರು",
        "ಯಾವ ವಿಭಾಗಗಳು ಇವೆ",
    ], ["department", "departments", "hod", "faculty", "lab", "labs", "ವಿಭಾಗ", "ಮುಖ್ಯಸ್ಥ"]),
    _intent("academic_calendar", ACADEMICS, {"academic_calendar"}, [
        "when does the semester start",
        "when do classes begin",
        "what is the academic calendar",
        "when are the holidays",
        "when does the term end",
        "ಸೆಮಿಸ್ಟರ್ ಯಾವಾಗ ಆರಂಭ",
        "ತರಗತಿಗಳು ಯಾವಾಗ ಶುರು",
        "ರಜೆಗಳು ಯಾವಾಗ",
    ], ["semester", "calendar", "classes begin", "holiday", "holidays", "vacation",
        "ಸೆಮಿಸ್ಟರ್", "ತರಗತಿ", "ರಜೆ", "ವೇಳಾಪಟ್ಟಿ"]),
    _intent("examination_information", ACADEMICS, {"examinations"}, [
        "when are the semester examinations",
        "when is the exam",
        "what is the exam timetable",
        "how are internal marks calculated",
        "when will the exam results come",
        "ಪರೀಕ್ಷೆ ಯಾವಾಗ",
        "ಪರೀಕ್ಷಾ ವೇಳಾಪಟ್ಟಿ ಏನು",
        "ಪರೀಕ್ಷೆಯ ಫಲಿತಾಂಶ ಯಾವಾಗ",
    ], ["exam", "exams", "examination", "examinations", "internal", "internals", "revaluation",
        "ಪರೀಕ್ಷೆ", "ಪರೀಕ್ಷಾ"]),

    # ------------------------------------------------------------ student services
    _intent("hostel_information", SERVICES, {"hostel"}, [
        "is there a hostel",
        "is there a hostel for girls",
        "how do i apply for hostel accommodation",
        "what facilities are in the hostel",
        "is food provided in the hostel",
        "ಹಾಸ್ಟೆಲ್ ಸೌಲಭ್ಯ ಇದೆಯೇ",
        "ಹುಡುಗಿಯರಿಗೆ ಹಾಸ್ಟೆಲ್ ಇದೆಯೇ",
        "ವಸತಿ ನಿಲಯಕ್ಕೆ ಅರ್ಜಿ ಹೇಗೆ",
    ], ["hostel", "hostels", "accommodation", "mess", "dorm",
        "ಹಾಸ್ಟೆಲ್", "ವಸತಿ"]),
    _intent("transport_information", SERVICES, {"transport"}, [
        "are there college buses",
        "is there a bus from the city",
        "what are the bus routes",
        "how do i get to the college by bus",
        "is transport available",
        "ಕಾಲೇಜು ಬಸ್ ಇದೆಯೇ",
        "ನಗರದಿಂದ ಬಸ್ ಇದೆಯೇ",
        "ಸಾರಿಗೆ ಸೌಲಭ್ಯ ಇದೆಯೇ",
    ], ["bus", "buses", "transport", "transportation", "route", "routes", "shuttle",
        "ಬಸ್", "ಸಾರಿಗೆ"]),
    _intent("student_services", SERVICES, {"student_services", "facilities"}, [
        "is there a library",
        "what student services are available",
        "is there a canteen",
        "is there a medical facility on campus",
        "are there sports facilities",
        "is there counselling for students",
        "ಗ್ರಂಥಾಲಯ ಇದೆಯೇ",
        "ಕ್ಯಾಂಟೀನ್ ಇದೆಯೇ",
        "ಕ್ರೀಡಾ ಸೌಲಭ್ಯಗಳು ಇವೆಯೇ",
    ], ["library", "canteen", "cafeteria", "medical", "clinic", "sports", "gym", "wifi", "club", "clubs",
        "facilities", "ಗ್ರಂಥಾಲಯ", "ಕ್ಯಾಂಟೀನ್", "ಕ್ರೀಡಾ", "ಸೌಲಭ್ಯ"]),
    _intent("contact_information", SERVICES, {"contacts"}, [
        "what is the phone number of the admission office",
        "how can i contact the college",
        "what is the email address of the office",
        "who should i contact for help",
        "ಕಾಲೇಜನ್ನು ಹೇಗೆ ಸಂಪರ್ಕಿಸುವುದು",
        "ಪ್ರವೇಶ ಕಚೇರಿಯ ದೂರವಾಣಿ ಸಂಖ್ಯೆ ಏನು",
        "ಯಾರನ್ನು ಸಂಪರ್ಕಿಸಬೇಕು",
    ], ["contact", "phone", "telephone", "email", "e-mail", "call", "helpline",
        "ಸಂಪರ್ಕ", "ದೂರವಾಣಿ", "ಫೋನ್", "ಇಮೇಲ್"]),

    # ------------------------------------------------------------ campus
    _intent("campus_navigation", CAMPUS, frozenset(), [
        "how do i get to the library from here",
        "take me to the admission office",
        "how do i reach the canteen",
        "show me the way to block a",
        "guide me to the auditorium",
        "ಇಲ್ಲಿಂದ ಗ್ರಂಥಾಲಯಕ್ಕೆ ಹೇಗೆ ಹೋಗುವುದು",
        "ಪ್ರವೇಶ ಕಚೇರಿಗೆ ದಾರಿ ತೋರಿಸಿ",
        "ಕ್ಯಾಂಟೀನ್‌ಗೆ ಹೇಗೆ ಹೋಗಬೇಕು",
    ], ["directions", "direction", "way to", "take me", "guide me", "navigate", "reach", "go to", "get to",
        "ದಾರಿ", "ಹೋಗುವುದು", "ಹೋಗಬೇಕು"], handler="workflow:campus_navigation"),
    _intent("office_location", CAMPUS, {"office_locations", "contacts"}, [
        "where is the admission office",
        "where is the accounts office",
        "in which building is the principal's office",
        "where is the exam section",
        "ಪ್ರವೇಶ ಕಚೇರಿ ಎಲ್ಲಿದೆ",
        "ಲೆಕ್ಕಪತ್ರ ಕಚೇರಿ ಎಲ್ಲಿದೆ",
        "ಪ್ರಾಂಶುಪಾಲರ ಕಚೇರಿ ಎಲ್ಲಿದೆ",
    ], ["office", "where is", "located", "location", "building", "block", "room number",
        "ಕಚೇರಿ", "ಎಲ್ಲಿದೆ"]),
    _intent("general_college_query", CAMPUS, {"overview", "faq"}, [
        "tell me about the college",
        "what is this college known for",
        "when was the college established",
        "is the college accredited",
        "what can you tell me about the campus",
        "ಕಾಲೇಜಿನ ಬಗ್ಗೆ ಹೇಳಿ",
        "ಈ ಕಾಲೇಜು ಯಾವಾಗ ಸ್ಥಾಪನೆಯಾಯಿತು",
        "ಕ್ಯಾಂಪಸ್ ಬಗ್ಗೆ ತಿಳಿಸಿ",
    ], [
        # Only words that ask about the institution itself. "college" and
        # "campus" appear in almost every College question, so they are
        # not evidence of a general query.
        "accredited", "accreditation", "established", "ranking", "history", "about the college",
        "ಸ್ಥಾಪನೆ", "ಮಾನ್ಯತೆ", "ಕಾಲೇಜಿನ ಬಗ್ಗೆ"]),
)


# ---------------------------------------------------------------- anchors
#
# What a College student says that is NOT a College information request.
# Acknowledgements, control words and unsafe requests are the engine's own
# shared anchors (intent_examples.NON_BANKING_ANCHORS), reused unchanged.
# OUT_OF_SCOPE adds the other domain: every Banking request example and
# Banking/general knowledge question, so a banking sentence typed into
# CampusGuide is recognised as out of scope instead of being forced into the
# nearest College intent.

_SHARED = {key: tuple(NON_BANKING_ANCHORS[key]) for key in ("ACKNOWLEDGEMENT", "CONTROL", "UNSUPPORTED")}

_BANKING_TEXT = tuple(text for texts in BANKING_INTENT_EXAMPLES.values() for text in texts)

ANCHORS = {
    **_SHARED,
    OUT_OF_SCOPE: _BANKING_TEXT + tuple(NON_BANKING_ANCHORS["KNOWLEDGE_QUESTION"]) + (
        "what is the weather today",
        "tell me a joke",
        "who won the cricket match",
        "book a movie ticket",
        "order food for me",
        "ಇಂದಿನ ಹವಾಮಾನ ಹೇಗಿದೆ",
        "ಒಂದು ಜೋಕ್ ಹೇಳಿ",
    ),
}

#: See THRESHOLDS above.
MARGIN = -0.05
MARGIN_WITHOUT_EVIDENCE = 0.10
AMBIGUITY_GAP = 0.02


def banking_sentence(text, college_evidence):
    """
    True when a sentence is a Banking request, by Banking's OWN lexical tables.

    - It names a Banking service (loan, account opening, deposit, withdrawal,
      balance; service_keywords.service_evidence): always out of scope here,
      including "education loan" -- CampusGuide does not advise on loans.
    - It names a banking operation the bank assistant declines (bills, cards,
      UPI, wallets, insurance; routing_safety) and NO College topic: out of
      scope. With a College topic ("pay the hostel fee by UPI") it is a
      College question about paying a College fee.
    """
    routing = normalize_turn(text).routing
    if service_evidence(routing):
        return True
    # "pay" alone names no College topic: paying is College business only
    # when a fee, the hostel, ... is named too.
    college_topics = set(college_evidence) - {"payment_process"}
    if not college_topics and (unsupported_operation_cues(routing) or declined_regardless_cues(routing)):
        return True
    return False

COLLEGE_INTENT_PROFILE = IntentProfile(
    domain="college",
    intents=INTENTS,
    anchors=ANCHORS,
    margin=MARGIN,
    margin_without_evidence=MARGIN_WITHOUT_EVIDENCE,
    ambiguity_gap=AMBIGUITY_GAP,
    out_of_scope_gate=banking_sentence,
    general_intents=frozenset({"general_college_query"}),
)
