# Kannada review cases (College, Phases 4–5)

**Status: UNREVIEWED.** Every Kannada string below was written by the development assistant, not by a
native speaker, and none has been reviewed. Nothing here may be described as validated Kannada until a
native speaker has gone through this list. Hindi renderings (in the same catalog) are equally unreviewed.
Tulu is not supported: a Tulu (`tcy`) session is answered in English.

Generated from `language_engine/app/domains/college/responses.py` and `intents.py`;
`debugging/test_college_workflows.py` fails if a Phase 5 Kannada sentence is missing here.

For each case: is it correct, natural and polite for a student; is the meaning identical to the English;
would a student say the example phrasings this way?

## 1. Reply sentences added in Phase 5 (workflows)

| # | English (canonical) | Kannada (unreviewed) | Reviewer note |
|---|---|---|---|
| W1 | Okay, I've stopped {topic}. | ಸರಿ, {topic} ನಿಲ್ಲಿಸಿದ್ದೇನೆ. |  |
| W2 | Okay, I've paused {topic}. Say resume to continue. | ಸರಿ, {topic} ತಡೆಹಿಡಿದಿದ್ದೇನೆ. ಮುಂದುವರಿಸಲು ಮುಂದುವರಿಸಿ ಎಂದು ಹೇಳಿ. | Tells the student to say ಮುಂದುವರಿಸಿ, which the shared classifier reads as resume (tested). Check it is what a student would say. |
| W3 | Say next to continue {topic}. | {topic} ಮುಂದುವರಿಸಲು ಮುಂದಿನದು ಎಂದು ಹೇಳಿ. | As above: ಮುಂದಿನದು is recognised as 'next'. |
| W4 | Say next to continue, repeat to hear it again, or cancel to stop. | ಮುಂದುವರಿಸಲು ಮುಂದಿನದು, ಮತ್ತೆ ಕೇಳಲು ಮತ್ತೆ ಹೇಳಿ, ನಿಲ್ಲಿಸಲು ನಿಲ್ಲಿಸಿ ಎಂದು ಹೇಳಿ. | Names ಮುಂದಿನದು / ಮತ್ತೆ ಹೇಳಿ / ನಿಲ್ಲಿಸಿ, all recognised by the shared classifier (tested). It does NOT recognise ಮುಂದೆ or ರದ್ದು alone; first draft said ರದ್ದು and was corrected. |
| W5 | There is nothing paused right now. | ಈಗ ಯಾವುದೂ ತಡೆಹಿಡಿಯಲ್ಪಟ್ಟಿಲ್ಲ. |  |
| W6 | First, the admission process. | ಮೊದಲು, ಪ್ರವೇಶ ಪ್ರಕ್ರಿಯೆ. |  |
| W7 | Next, the documents you need. | ಮುಂದೆ, ನಿಮಗೆ ಬೇಕಾದ ದಾಖಲೆಗಳು. |  |
| W8 | Next, eligibility. | ಮುಂದೆ, ಅರ್ಹತೆ. |  |
| W9 | Next, what to do now. | ಮುಂದೆ, ಈಗ ಏನು ಮಾಡಬೇಕು. |  |
| W10 | Finally, where to get help. | ಕೊನೆಯದಾಗಿ, ಸಹಾಯ ಎಲ್ಲಿ ಸಿಗುತ್ತದೆ. |  |
| W11 | Say next to continue with {topic}. | {topic} ಕುರಿತು ಮುಂದುವರಿಸಲು ಮುಂದಿನದು ಎಂದು ಹೇಳಿ. | As above. |
| W12 | That is the end of the admission guidance. | ಪ್ರವೇಶ ಮಾರ್ಗದರ್ಶನ ಇಲ್ಲಿಗೆ ಮುಗಿಯಿತು. |  |
| W13 | I'll check your admission status in CampusGuide. | CampusGuide ನಲ್ಲಿ ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿಯನ್ನು ಪರಿಶೀಲಿಸುತ್ತೇನೆ. |  |
| W14 | Your admission details from the official records are shown below. | ಅಧಿಕೃತ ದಾಖಲೆಗಳಿಂದ ನಿಮ್ಮ ಪ್ರವೇಶ ವಿವರಗಳನ್ನು ಕೆಳಗೆ ತೋರಿಸಲಾಗಿದೆ. |  |
| W15 | Please sign in to your CampusGuide account to see your admission status. | ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ನೋಡಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ CampusGuide ಖಾತೆಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ. |  |
| W16 | I couldn't find an admission record for the email address of your account. | ನಿಮ್ಮ ಖಾತೆಯ ಇಮೇಲ್ ವಿಳಾಸಕ್ಕೆ ಹೊಂದುವ ಪ್ರವೇಶ ದಾಖಲೆ ನನಗೆ ಸಿಗಲಿಲ್ಲ. |  |
| W17 | If you applied with a different email address, please contact the admission office. | ನೀವು ಬೇರೆ ಇಮೇಲ್ ವಿಳಾಸದಿಂದ ಅರ್ಜಿ ಸಲ್ಲಿಸಿದ್ದರೆ, ದಯವಿಟ್ಟು ಪ್ರವೇಶ ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ. |  |
| W18 | More than one admission record matches your account, so I can't show one. | ನಿಮ್ಮ ಖಾತೆಗೆ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ಪ್ರವೇಶ ದಾಖಲೆಗಳು ಹೊಂದುತ್ತವೆ, ಆದ್ದರಿಂದ ಯಾವುದನ್ನೂ ತೋರಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. |  |
| W19 | Please contact the admission office. | ದಯವಿಟ್ಟು ಪ್ರವೇಶ ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ. |  |
| W20 | Please scan the CampusGuide QR code again to continue. | ಮುಂದುವರಿಸಲು ದಯವಿಟ್ಟು CampusGuide QR ಕೋಡ್ ಅನ್ನು ಮತ್ತೆ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. |  |
| W21 | I can't check your admission status right now. Please try again later or open the Result page. | ಈಗ ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ನಂತರ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಫಲಿತಾಂಶ ಪುಟವನ್ನು ತೆರೆಯಿರಿ. |  |
| W22 | Admission status is available only to student accounts. | ಪ್ರವೇಶದ ಸ್ಥಿತಿ ವಿದ್ಯಾರ್ಥಿ ಖಾತೆಗಳಿಗೆ ಮಾತ್ರ ಲಭ್ಯವಿದೆ. |  |
| W23 | For your security, I don't use reference numbers typed in the chat. | ನಿಮ್ಮ ಸುರಕ್ಷತೆಗಾಗಿ, ಚಾಟ್‌ನಲ್ಲಿ ಟೈಪ್ ಮಾಡಿದ ರೆಫರೆನ್ಸ್ ಸಂಖ್ಯೆಗಳನ್ನು ನಾನು ಬಳಸುವುದಿಲ್ಲ. | Security message: must be unambiguous that the number was NOT used. |
| W24 | Where would you like to go? | ನೀವು ಎಲ್ಲಿಗೆ ಹೋಗಬೇಕು? |  |
| W25 | I don't have verified campus directions for this college yet. | ಈ ಕಾಲೇಜಿನ ಪರಿಶೀಲಿತ ಕ್ಯಾಂಪಸ್ ದಾರಿ ಮಾಹಿತಿ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲ. |  |
| W26 | Please scan the CampusGuide QR code nearest to you, so I know where you are. | ನೀವು ಎಲ್ಲಿದ್ದೀರಿ ಎಂದು ತಿಳಿಯಲು, ದಯವಿಟ್ಟು ನಿಮ್ಮ ಹತ್ತಿರದ CampusGuide QR ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. |  |
| W27 | I don't have verified directions from this QR code's location yet. | ಈ QR ಕೋಡ್ ಇರುವ ಸ್ಥಳದಿಂದ ಪರಿಶೀಲಿತ ದಾರಿ ಮಾಹಿತಿ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲ. |  |
| W28 | I couldn't find that place in the verified campus map. | ಪರಿಶೀಲಿತ ಕ್ಯಾಂಪಸ್ ನಕ್ಷೆಯಲ್ಲಿ ಆ ಸ್ಥಳ ನನಗೆ ಸಿಗಲಿಲ್ಲ. |  |
| W29 | Please tell me another place, or say cancel. | ದಯವಿಟ್ಟು ಬೇರೆ ಸ್ಥಳ ಹೇಳಿ, ಅಥವಾ ನಿಲ್ಲಿಸಿ ಎಂದು ಹೇಳಿ. | Names ನಿಲ್ಲಿಸಿ (recognised as cancel, tested). First draft said ರದ್ದು, which is not recognised. |
| W30 | Say next for the next step. | ಮುಂದಿನ ಹಂತಕ್ಕೆ ಮುಂದಿನದು ಎಂದು ಹೇಳಿ. |  |
| W31 | That was the last step. | ಅದು ಕೊನೆಯ ಹಂತ. |  |
| W32 | I don't have verified directions from {place} to {place2} yet. | {place} ನಿಂದ {place2} ಗೆ ಪರಿಶೀಲಿತ ದಾರಿ ಮಾಹಿತಿ ನನ್ನ ಬಳಿ ಇನ್ನೂ ಇಲ್ಲ. | Place names are inserted as written in the map; the case ending (ನಿಂದ / ಗೆ) is written as a separate word after the name ("ಗ್ರಂಥಾಲಯ ಗೆ"), which reads awkwardly. Needs a decision: per-place inflected forms in the map, or a sentence shape that avoids inflecting the name. |
| W33 | You are already at {place}. | ನೀವು ಈಗಾಗಲೇ {place} ನಲ್ಲಿದ್ದೀರಿ. | Same case-ending issue ("… ನಲ್ಲಿದ್ದೀರಿ"). |
| W34 | Here are the directions from {place} to {place2}. | {place} ನಿಂದ {place2} ಗೆ ಹೋಗುವ ದಾರಿ ಇಲ್ಲಿದೆ. | Same case-ending issue as above ("ಪ್ರವೇಶ ಕೌಂಟರ್ ನಿಂದ ಗ್ರಂಥಾಲಯ ಗೆ"). |
| W35 | Step {n} of {k}: | ಹಂತ {n} / {k}: | Digits are kept as Western digits. |
| W36 | Do you mean {place} or {place2}? | ನೀವು {place} ಎನ್ನುತ್ತಿದ್ದೀರಾ ಅಥವಾ {place2}? |  |

## 2. Reply sentences from Phase 4

| # | English (canonical) | Kannada (unreviewed) |
|---|---|---|
| P1 | I don't have verified information about {topic} yet. | {topic} ಕುರಿತು ನನ್ನ ಬಳಿ ಇನ್ನೂ ಪರಿಶೀಲಿತ ಮಾಹಿತಿ ಇಲ್ಲ. |
| P2 | I don't have verified information about that yet. | ಅದರ ಕುರಿತು ನನ್ನ ಬಳಿ ಇನ್ನೂ ಪರಿಶೀಲಿತ ಮಾಹಿತಿ ಇಲ್ಲ. |
| P3 | Please contact the college office for help. | ಸಹಾಯಕ್ಕಾಗಿ ದಯವಿಟ್ಟು ಕಾಲೇಜು ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ. |
| P4 | I can help only with questions about the college, such as admissions, fees, courses, hostel and transport. | ನಾನು ಕಾಲೇಜಿಗೆ ಸಂಬಂಧಿಸಿದ ಪ್ರಶ್ನೆಗಳಿಗೆ ಮಾತ್ರ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ, ಉದಾಹರಣೆಗೆ ಪ್ರವೇಶ, ಶುಲ್ಕ, ಕೋರ್ಸ್‌ಗಳು, ಹಾಸ್ಟೆಲ್ ಮತ್ತು ಸಾರಿಗೆ. |
| P5 | Sorry, I can't help with that. | ಕ್ಷಮಿಸಿ, ಅದರಲ್ಲಿ ನಾನು ಸಹಾಯ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ. |
| P6 | Okay. What would you like to know about the college? | ಸರಿ. ಕಾಲೇಜಿನ ಬಗ್ಗೆ ನಿಮಗೆ ಏನು ತಿಳಿಯಬೇಕು? |
| P7 | You're welcome. Is there anything else you would like to know? | ಸ್ವಾಗತ. ಇನ್ನೇನಾದರೂ ತಿಳಿಯಬೇಕೇ? |
| P8 | You can ask me about admissions, documents, fees, scholarships, courses, exams, hostel, transport and contacts. | ಪ್ರವೇಶ, ದಾಖಲೆಗಳು, ಶುಲ್ಕ, ವಿದ್ಯಾರ್ಥಿವೇತನ, ಕೋರ್ಸ್‌ಗಳು, ಪರೀಕ್ಷೆಗಳು, ಹಾಸ್ಟೆಲ್, ಸಾರಿಗೆ ಮತ್ತು ಸಂಪರ್ಕದ ಬಗ್ಗೆ ನೀವು ನನ್ನನ್ನು ಕೇಳಬಹುದು. |
| P9 | Do you mean {topic} or {topic2}? | ನೀವು {topic} ಬಗ್ಗೆ ಕೇಳುತ್ತಿದ್ದೀರಾ ಅಥವಾ {topic2} ಬಗ್ಗೆ? |
| P10 | I can't check {topic} in the assistant yet. | ಸಹಾಯಕದಲ್ಲಿ {topic} ಇನ್ನೂ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. |
| P11 | Please use the CampusGuide portal for that. | ಅದಕ್ಕಾಗಿ ದಯವಿಟ್ಟು CampusGuide ಪೋರ್ಟಲ್ ಬಳಸಿ. |
| P12 | There is no task in progress right now. | ಈಗ ಯಾವುದೇ ಕಾರ್ಯ ನಡೆಯುತ್ತಿಲ್ಲ. |
| P13 | There is nothing to repeat yet. | ಮತ್ತೆ ಹೇಳಲು ಇನ್ನೂ ಏನೂ ಇಲ್ಲ. |
| P14 | Thank you for using CampusGuide. | CampusGuide ಬಳಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. |
| P15 | Sorry, I hit a temporary problem. Please ask that again. | ಕ್ಷಮಿಸಿ, ತಾತ್ಕಾಲಿಕ ತೊಂದರೆ ಆಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕೇಳಿ. |
| P16 | I did not catch that. Could you say it again? | ನನಗೆ ಅದು ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ? |
| P17 | Please scan the CampusGuide QR code for your college first. | ದಯವಿಟ್ಟು ಮೊದಲು ನಿಮ್ಮ ಕಾಲೇಜಿನ CampusGuide QR ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. |

## 3. Topic names (inserted into {topic} slots)

| English | Kannada (unreviewed) |
|---|---|
| the admission process | ಪ್ರವೇಶ ಪ್ರಕ್ರಿಯೆ |
| admission documents | ಪ್ರವೇಶ ದಾಖಲೆಗಳು |
| admission eligibility | ಪ್ರವೇಶ ಅರ್ಹತೆ |
| your admission status | ನಿಮ್ಮ ಪ್ರವೇಶದ ಸ್ಥಿತಿ |
| fees | ಶುಲ್ಕ |
| fee payment | ಶುಲ್ಕ ಪಾವತಿ |
| scholarships | ವಿದ್ಯಾರ್ಥಿವೇತನ |
| courses | ಕೋರ್ಸ್‌ಗಳು |
| departments | ವಿಭಾಗಗಳು |
| the academic calendar | ಶೈಕ್ಷಣಿಕ ವೇಳಾಪಟ್ಟಿ |
| examinations | ಪರೀಕ್ಷೆಗಳು |
| the hostel | ಹಾಸ್ಟೆಲ್ |
| transport | ಸಾರಿಗೆ |
| student services | ವಿದ್ಯಾರ್ಥಿ ಸೇವೆಗಳು |
| contact details | ಸಂಪರ್ಕ ವಿವರಗಳು |
| campus directions | ಕ್ಯಾಂಪಸ್ ದಾರಿ |
| office locations | ಕಚೇರಿಗಳ ಸ್ಥಳ |
| the college | ಕಾಲೇಜು |
| the admission guidance | ಪ್ರವೇಶ ಮಾರ್ಗದರ್ಶನ |
| the directions | ದಾರಿ ಮಾರ್ಗದರ್ಶನ |
| the admission status check | ಪ್ರವೇಶ ಸ್ಥಿತಿಯ ಪರಿಶೀಲನೆ |
| the documents you need | ನಿಮಗೆ ಬೇಕಾದ ದಾಖಲೆಗಳು |
| eligibility | ಅರ್ಹತೆ |
| what to do now | ಈಗ ಏನು ಮಾಡಬೇಕು |
| where to get help | ಸಹಾಯ ಎಲ್ಲಿ ಸಿಗುತ್ತದೆ |

## 4. Kannada intent examples and keywords

Used to recognise what a student asks. Check each is something a student would really say, and add
common phrasings that are missing (held-out measurement, Phase 4: 16/18 Kannada utterances recognised).

- **admission_process** (workflow:admission_guidance): examples: ಪ್ರವೇಶ ಪ್ರಕ್ರಿಯೆ ಏನು; ಕಾಲೇಜಿಗೆ ಪ್ರವೇಶ ಪಡೆಯುವುದು ಹೇಗೆ; ಅರ್ಜಿ ಸಲ್ಲಿಸುವುದು ಹೇಗೆ; ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಕೊನೆಯ ದಿನಾಂಕ ಯಾವುದು. Keywords: ಪ್ರವೇಶ, ಅರ್ಜಿ, ದಾಖಲಾತಿ.
- **admission_documents** (knowledge): examples: ಪ್ರವೇಶಕ್ಕೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು; ಯಾವ ಪ್ರಮಾಣಪತ್ರಗಳನ್ನು ತರಬೇಕು; ದಾಖಲೆಗಳ ಪಟ್ಟಿ ಹೇಳಿ. Keywords: ದಾಖಲೆ, ಪ್ರಮಾಣಪತ್ರ, ಅಂಕಪಟ್ಟಿ.
- **admission_eligibility** (knowledge): examples: ಪ್ರವೇಶಕ್ಕೆ ಅರ್ಹತೆ ಏನು; ನಾನು ಅರ್ಹನೇ; ಕನಿಷ್ಠ ಅಂಕಗಳು ಎಷ್ಟು ಬೇಕು. Keywords: ಅರ್ಹತೆ, ಅರ್ಹ, ಕನಿಷ್ಠ.
- **admission_status** (workflow:admission_status): examples: ನನ್ನ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ಏನು; ನನಗೆ ಸೀಟು ಸಿಕ್ಕಿದೆಯೇ; ನನ್ನ ಫಲಿತಾಂಶ ನೋಡಬೇಕು. Keywords: ಸ್ಥಿತಿ, ಫಲಿತಾಂಶ, ಸೀಟು.
- **fee_information** (knowledge): examples: ಶುಲ್ಕ ಎಷ್ಟು; ಕೋರ್ಸಿನ ಶುಲ್ಕ ಎಷ್ಟು; ವಾರ್ಷಿಕ ಶುಲ್ಕ ಎಷ್ಟು. Keywords: ಶುಲ್ಕ, ಫೀಸ್, ಫೀ.
- **payment_process** (knowledge): examples: ಶುಲ್ಕವನ್ನು ಹೇಗೆ ಪಾವತಿಸುವುದು; ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಪಾವತಿಸಬಹುದೇ; ಎಲ್ಲಿ ಹಣ ಕಟ್ಟಬೇಕು. Keywords: ಪಾವತಿ, ಕಟ್ಟಬೇಕು, ಕಟ್ಟುವುದು.
- **scholarship_information** (knowledge): examples: ವಿದ್ಯಾರ್ಥಿವೇತನ ಸಿಗುತ್ತದೆಯೇ; ವಿದ್ಯಾರ್ಥಿವೇತನಕ್ಕೆ ಅರ್ಜಿ ಹೇಗೆ; ಶುಲ್ಕ ರಿಯಾಯಿತಿ ಇದೆಯೇ. Keywords: ವಿದ್ಯಾರ್ಥಿವೇತನ, ರಿಯಾಯಿತಿ, ಸ್ಕಾಲರ್.
- **course_information** (knowledge): examples: ಯಾವ ಕೋರ್ಸುಗಳು ಇವೆ; ಯಾವ ಪದವಿ ಕಾರ್ಯಕ್ರಮಗಳು ಲಭ್ಯವಿವೆ; ಎಂಜಿನಿಯರಿಂಗ್ ಕೋರ್ಸ್ ಬಗ್ಗೆ ಹೇಳಿ. Keywords: ಕೋರ್ಸ್, ಕೋರ್ಸು, ಪದವಿ, ಕಾರ್ಯಕ್ರಮ.
- **department_information** (knowledge): examples: ವಿಭಾಗದ ಬಗ್ಗೆ ಹೇಳಿ; ವಿಭಾಗದ ಮುಖ್ಯಸ್ಥರು ಯಾರು; ಯಾವ ವಿಭಾಗಗಳು ಇವೆ. Keywords: ವಿಭಾಗ, ಮುಖ್ಯಸ್ಥ.
- **academic_calendar** (knowledge): examples: ಸೆಮಿಸ್ಟರ್ ಯಾವಾಗ ಆರಂಭ; ತರಗತಿಗಳು ಯಾವಾಗ ಶುರು; ರಜೆಗಳು ಯಾವಾಗ. Keywords: ಸೆಮಿಸ್ಟರ್, ತರಗತಿ, ರಜೆ, ವೇಳಾಪಟ್ಟಿ.
- **examination_information** (knowledge): examples: ಪರೀಕ್ಷೆ ಯಾವಾಗ; ಪರೀಕ್ಷಾ ವೇಳಾಪಟ್ಟಿ ಏನು; ಪರೀಕ್ಷೆಯ ಫಲಿತಾಂಶ ಯಾವಾಗ. Keywords: ಪರೀಕ್ಷೆ, ಪರೀಕ್ಷಾ.
- **hostel_information** (knowledge): examples: ಹಾಸ್ಟೆಲ್ ಸೌಲಭ್ಯ ಇದೆಯೇ; ಹುಡುಗಿಯರಿಗೆ ಹಾಸ್ಟೆಲ್ ಇದೆಯೇ; ವಸತಿ ನಿಲಯಕ್ಕೆ ಅರ್ಜಿ ಹೇಗೆ. Keywords: ಹಾಸ್ಟೆಲ್, ವಸತಿ.
- **transport_information** (knowledge): examples: ಕಾಲೇಜು ಬಸ್ ಇದೆಯೇ; ನಗರದಿಂದ ಬಸ್ ಇದೆಯೇ; ಸಾರಿಗೆ ಸೌಲಭ್ಯ ಇದೆಯೇ. Keywords: ಬಸ್, ಸಾರಿಗೆ.
- **student_services** (knowledge): examples: ಗ್ರಂಥಾಲಯ ಇದೆಯೇ; ಕ್ಯಾಂಟೀನ್ ಇದೆಯೇ; ಕ್ರೀಡಾ ಸೌಲಭ್ಯಗಳು ಇವೆಯೇ. Keywords: ಗ್ರಂಥಾಲಯ, ಕ್ಯಾಂಟೀನ್, ಕ್ರೀಡಾ, ಸೌಲಭ್ಯ.
- **contact_information** (knowledge): examples: ಕಾಲೇಜನ್ನು ಹೇಗೆ ಸಂಪರ್ಕಿಸುವುದು; ಪ್ರವೇಶ ಕಚೇರಿಯ ದೂರವಾಣಿ ಸಂಖ್ಯೆ ಏನು; ಯಾರನ್ನು ಸಂಪರ್ಕಿಸಬೇಕು. Keywords: ಸಂಪರ್ಕ, ದೂರವಾಣಿ, ಫೋನ್, ಇಮೇಲ್.
- **campus_navigation** (workflow:campus_navigation): examples: ಇಲ್ಲಿಂದ ಗ್ರಂಥಾಲಯಕ್ಕೆ ಹೇಗೆ ಹೋಗುವುದು; ಪ್ರವೇಶ ಕಚೇರಿಗೆ ದಾರಿ ತೋರಿಸಿ; ಕ್ಯಾಂಟೀನ್‌ಗೆ ಹೇಗೆ ಹೋಗಬೇಕು. Keywords: ದಾರಿ, ಹೋಗುವುದು, ಹೋಗಬೇಕು.
- **office_location** (knowledge): examples: ಪ್ರವೇಶ ಕಚೇರಿ ಎಲ್ಲಿದೆ; ಲೆಕ್ಕಪತ್ರ ಕಚೇರಿ ಎಲ್ಲಿದೆ; ಪ್ರಾಂಶುಪಾಲರ ಕಚೇರಿ ಎಲ್ಲಿದೆ. Keywords: ಕಚೇರಿ, ಎಲ್ಲಿದೆ.
- **general_college_query** (knowledge): examples: ಕಾಲೇಜಿನ ಬಗ್ಗೆ ಹೇಳಿ; ಈ ಕಾಲೇಜು ಯಾವಾಗ ಸ್ಥಾಪನೆಯಾಯಿತು; ಕ್ಯಾಂಪಸ್ ಬಗ್ಗೆ ತಿಳಿಸಿ. Keywords: ಸ್ಥಾಪನೆ, ಮಾನ್ಯತೆ, ಕಾಲೇಜಿನ ಬಗ್ಗೆ.

## 5. Known Kannada issues to decide

1. Case endings after place names (W-rows with notes above): the map gives a place's name only in its
   base form.
2. Control words: replies name only words the shared classifier recognises (ಮುಂದಿನದು, ಮತ್ತೆ ಹೇಳಿ, ನಿಲ್ಲಿಸಿ,
   ಮುಂದುವರಿಸಿ; अगला, दोहराइए, रद्द करो, जारी रखिए) -- a test enforces it. Common words a student may say that
   are NOT recognised: ಮುಂದೆ, ರದ್ದು, रद्द, रोको, फिर से बोलो. Adding them changes the classifier Banking shares, so
   it needs a Banking regression run and is left for review.
3. Campus place names and route steps are the institution's own data (the map), not catalog text: they are
   reviewed by the institution when it verifies its map. A step with no Kannada in the map is shown in
   English with the untranslated marker.
4. Model-written answers in Kannada (grounded answers) are not covered by this list; their quality has not
   been measured (Phase 4 limitation).

## 6. Phase 6 additions (unreviewed)

Student Portal chat labels added in Phase 6 (`college-domain/frontend/src/i18n/kn.ts`, `hi.ts`), authored by the
development assistant and **unreviewed** by a native speaker:

| Key | Kannada | Hindi |
|---|---|---|
| chat.details.title | ನಿಮ್ಮ ಪ್ರವೇಶ ವಿವರಗಳು | आपके प्रवेश विवरण |
| chat.details.source | ನಿಮ್ಮ ಲಾಗಿನ್ ಖಾತೆಯ ಅಧಿಕೃತ ಪ್ರವೇಶ ದಾಖಲೆಗಳಿಂದ. | आपके साइन-इन खाते के आधिकारिक प्रवेश रिकॉर्ड से। |
| chat.details.category | ಪ್ರವೇಶ ವರ್ಗ | प्रवेश श्रेणी |
| chat.details.batch | ನಿಗದಿತ ಬ್ಯಾಚ್ | निर्धारित बैच |
| chat.details.hall | ಪ್ರವೇಶ ಸಭಾಂಗಣ | प्रवेश हॉल |
| chat.details.nextStep | ಮುಂದಿನ ಹಂತ | अगला चरण |
| chat.details.notAvailable | ಇನ್ನೂ ಲಭ್ಯವಿಲ್ಲ | अभी उपलब्ध नहीं |
| chat.listen | ಆಲಿಸಿ | सुनें |
| chat.listenFailed | ಮಾತಿನ ಉತ್ತರವನ್ನು ಪ್ಲೇ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಮೇಲಿನ ಉತ್ತರವನ್ನು ನೀವು ಓದಬಹುದು. | बोला गया उत्तर चलाया नहीं जा सका। आप ऊपर दिया उत्तर पढ़ सकते हैं। |
| chat.voiceInputUnavailable | ಧ್ವನಿ ಇನ್‌ಪುಟ್ ಇನ್ನೂ ಲಭ್ಯವಿಲ್ಲ. ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ; ಉತ್ತರ ಕೇಳಲು ಆಲಿಸಿ ಬಳಸಿ. | आवाज़ से प्रश्न पूछना अभी उपलब्ध नहीं है। अपना प्रश्न टाइप करें; उत्तर सुनने के लिए सुनें दबाएँ। |
| error.assistantUnavailable | CampusGuide ಸಹಾಯಕ ಈಗ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. | CampusGuide सहायक अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर से कोशिश करें। |

Phase 6 added English-only intent examples/keywords to `admission_status` (my rank / my batch / admission hall);
no new Kannada intent examples.

