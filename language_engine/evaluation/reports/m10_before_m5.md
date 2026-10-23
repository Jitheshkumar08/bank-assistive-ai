# M10 routing evaluation: m10_before_m5

Fixtures: `m5_fresh.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 40 | 2 | 21/26 | 2 | 7/14 | 6 | 0/4 | 0/0 | 0/0 | 2/6 | 1/2 |
| pending policy | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: ambiguous_request | 4 | 0 | 0/0 | 0 | 3/4 | 3 | 0/4 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: knowledge_question | 6 | 2 | 0/0 | 0 | 4/6 | 3 | 0/0 | 0/0 | 0/0 | 2/6 | 1/2 |
| family: refusal | 4 | 0 | 0/0 | 0 | 0/4 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: service_request | 26 | 0 | 21/26 | 2 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 6 | 0 | 3/3 | 0 | 2/3 | 2 | 0/1 | 0/0 | 0/0 | 0/1 | 0/0 |
| lang: kn | 5 | 0 | 1/2 | 1 | 2/3 | 2 | 0/2 | 0/0 | 0/0 | 0/1 | 0/0 |
| lang: hi | 6 | 0 | 3/4 | 0 | 2/2 | 1 | 0/1 | 0/0 | 0/0 | 0/1 | 0/0 |
| lang: kn-en | 8 | 1 | 5/6 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 0/1 |
| lang: hi-en | 7 | 1 | 5/5 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 1/1 |
| lang: rom-kn | 3 | 0 | 3/3 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: rom-hi | 5 | 0 | 1/3 | 1 | 1/2 | 1 | 0/0 | 0/0 | 0/0 | 0/1 | 0/0 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| svc-kn-en-504 | settled | ಬ್ಯಾಲೆನ್ಸ್‌ ಚೆಕ್ ಮಾಡಬೇಕಿತ್ತು | start:check account balance | answer | missed (answer) |
| svc-rom-hi-502 | settled | mujhe lone chahiye | start:apply for loan | answer | missed (answer) |
| svc-rom-hi-503 | settled | khaate mein cash daalna hai | start:deposit money | start:open new account | wrong_service |
| svc-kn-502 | settled | ಖಾತೆಯಲ್ಲಿ ಉಳಿದ ಹಣ ತಿಳಿಸಿ | start:check account balance | start:deposit money | wrong_service |
| svc-hi-504 | settled | खाते में बची राशि दिखाइए | start:check account balance | answer | missed (answer) |
| kq-en-501 | settled | home loan interest rate | question | start:apply for loan | false_start |
| kq-kn-501 | settled | ಗೃಹ ಸಾಲದ ಅರ್ಹತೆ | question | start:apply for loan | false_start |
| kq-hi-501 | settled | चालू खाते के नियम | question | start:open new account | false_start |
| kq-rom-hi-501 | settled | loan ki byaj dar | question | start:apply for loan | false_start |
| kq-kn-en-502 | settled | ಚೆಕ್ ಬುಕ್ ಹೇಗೆ ಪಡೆಯುವುದು | question | llm_gate | llm_gated |
| kq-hi-en-502 | settled | एकाउंट कैसे खोलें। | question | llm_gate | llm_gated |
| amb-kn-501 | settled | ನನಗೆ ದುಡ್ಡಿನ ಅವಶ್ಯಕತೆ ಇದೆ | clarify | start:withdraw money | false_start |
| amb-hi-501 | settled | पैसों की ज़रूरत है | clarify | start:deposit money | false_start |
| amb-kn-502 | settled | ಬ್ಯಾಂಕಿನಲ್ಲಿ ಸ್ವಲ್ಪ ಕೆಲಸ ಇದೆ | clarify | answer | no_start_other_reply (answer) |
| amb-en-501 | settled | I came for some banking work | clarify | start:deposit money | false_start |
