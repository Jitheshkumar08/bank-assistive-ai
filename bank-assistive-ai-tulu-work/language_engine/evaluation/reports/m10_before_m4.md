# M10 routing evaluation: m10_before_m4

Fixtures: `m4_heldout.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 57 | 0 | 31/39 | 5 | 12/18 | 10 | 0/8 | 0/0 | 0/0 | 3/10 | 0/0 |
| pending policy | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: ambiguous_request | 8 | 0 | 0/0 | 0 | 5/8 | 3 | 0/8 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: knowledge_question | 10 | 0 | 0/0 | 0 | 7/10 | 7 | 0/0 | 0/0 | 0/0 | 3/10 | 0/0 |
| family: service_request | 39 | 0 | 31/39 | 5 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 9 | 0 | 5/5 | 0 | 3/4 | 2 | 0/2 | 0/0 | 0/0 | 1/2 | 0/0 |
| lang: kn | 8 | 0 | 3/5 | 1 | 2/3 | 2 | 0/1 | 0/0 | 0/0 | 1/2 | 0/0 |
| lang: hi | 8 | 0 | 3/5 | 2 | 2/3 | 2 | 0/1 | 0/0 | 0/0 | 1/2 | 0/0 |
| lang: kn-en | 11 | 0 | 8/9 | 0 | 2/2 | 1 | 0/1 | 0/0 | 0/0 | 0/1 | 0/0 |
| lang: hi-en | 7 | 0 | 5/5 | 0 | 1/2 | 1 | 0/1 | 0/0 | 0/0 | 0/1 | 0/0 |
| lang: rom-kn | 7 | 0 | 4/5 | 1 | 1/2 | 1 | 0/1 | 0/0 | 0/0 | 0/1 | 0/0 |
| lang: rom-hi | 7 | 0 | 3/5 | 1 | 1/2 | 1 | 0/1 | 0/0 | 0/0 | 0/1 | 0/0 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| svc-kn-401 | settled | ನನ್ನ ಖಾತೆಗೆ ಐನೂರು ರೂಪಾಯಿ ಹಾಕಬೇಕು | start:deposit money | start:check account balance | wrong_service |
| svc-hi-401 | settled | मेरे खाते में दो हज़ार डालने हैं | start:deposit money | start:withdraw money | wrong_service |
| svc-rom-hi-401 | settled | mere khate mein paise daalne hain | start:deposit money | start:open new account | wrong_service |
| svc-rom-kn-401 | settled | nanna account ge duddu haakbeku | start:deposit money | start:withdraw money | wrong_service |
| svc-hi-403 | settled | मेरे खाते में बची रकम बताइए | start:check account balance | start:deposit money | wrong_service |
| svc-kn-404 | settled | ವ್ಯವಸಾಯಕ್ಕಾಗಿ ಸಾಲ ಬೇಕು | start:apply for loan | answer | missed (answer) |
| svc-kn-en-408 | settled | ನನಗೆ ಹೊಸ savings account ಬೇಕು | start:open new account | clarify | missed (clarify) |
| svc-rom-hi-405 | settled | mujhe naya bank account chahiye | start:open new account | clarify | missed (clarify) |
| amb-en-401 | settled | I need money | clarify | start:withdraw money | false_start |
| amb-en-402 | settled | I have some work with my account | clarify | start:check account balance | false_start |
| amb-kn-401 | settled | ನನಗೆ ಹಣ ಬೇಕು | clarify | start:deposit money | false_start |
| amb-hi-401 | settled | मुझे पैसे चाहिए | clarify | start:withdraw money | false_start |
| amb-kn-en-401 | settled | ಅಕೌಂಟ್ ಕೆಲಸ ಇದೆ | clarify | start:check account balance | false_start |
| amb-hi-en-401 | settled | bank का काम है | clarify | answer | no_start_other_reply (answer) |
| amb-rom-hi-401 | settled | paise chahiye | clarify | no-start:CONTROL | no_start_other_reply (no-start:CONTROL) |
| amb-rom-kn-401 | settled | duddu beku | clarify | no-start:ACKNOWLEDGEMENT | no_start_other_reply (no-start:ACKNOWLEDGEMENT) |
| kq-en-401 | settled | loan eligibility criteria | question | start:apply for loan | false_start |
| kq-kn-401 | settled | ಶಿಕ್ಷಣ ಸಾಲದ ನಿಯಮಗಳು | question | start:apply for loan | false_start |
| kq-hi-402 | settled | कर्ज की पात्रता शर्तें | question | start:apply for loan | false_start |
| kq-kn-en-401 | settled | loan eligibility ನಿಯಮಗಳು | question | start:apply for loan | false_start |
| kq-hi-en-401 | settled | loan की eligibility शर्तें | question | start:apply for loan | false_start |
| kq-rom-hi-401 | settled | loan ki eligibility conditions | question | start:apply for loan | false_start |
| kq-rom-kn-401 | settled | loan eligibility niyamagalu | question | start:apply for loan | false_start |
