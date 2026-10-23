# M10 routing evaluation: m10_policy_m4

Fixtures: `m4_heldout.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline; `approved:Dn` rows count in it.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 57 | 0 | 35/39 | 0 | 0/18 | 0 | 5/8 | 0/0 | 0/0 | 10/10 | 0/0 |
| of which approved-policy rows (D1/D3/D5) | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pending policy | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: ambiguous_request | 8 | 0 | 0/0 | 0 | 0/8 | 0 | 5/8 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: knowledge_question | 10 | 0 | 0/0 | 0 | 0/10 | 0 | 0/0 | 0/0 | 0/0 | 10/10 | 0/0 |
| family: service_request | 39 | 0 | 35/39 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 9 | 0 | 5/5 | 0 | 0/4 | 0 | 2/2 | 0/0 | 0/0 | 2/2 | 0/0 |
| lang: kn | 8 | 0 | 3/5 | 0 | 0/3 | 0 | 1/1 | 0/0 | 0/0 | 2/2 | 0/0 |
| lang: hi | 8 | 0 | 5/5 | 0 | 0/3 | 0 | 1/1 | 0/0 | 0/0 | 2/2 | 0/0 |
| lang: kn-en | 11 | 0 | 8/9 | 0 | 0/2 | 0 | 1/1 | 0/0 | 0/0 | 1/1 | 0/0 |
| lang: hi-en | 7 | 0 | 5/5 | 0 | 0/2 | 0 | 0/1 | 0/0 | 0/0 | 1/1 | 0/0 |
| lang: rom-kn | 7 | 0 | 5/5 | 0 | 0/2 | 0 | 0/1 | 0/0 | 0/0 | 1/1 | 0/0 |
| lang: rom-hi | 7 | 0 | 4/5 | 0 | 0/2 | 0 | 0/1 | 0/0 | 0/0 | 1/1 | 0/0 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| svc-kn-403 | settled | ನನ್ನ ಖಾತೆಯಲ್ಲಿರುವ ಹಣ ತಿಳಿಸಿ | start:check account balance | clarify | missed (clarify) |
| svc-kn-404 | settled | ವ್ಯವಸಾಯಕ್ಕಾಗಿ ಸಾಲ ಬೇಕು | start:apply for loan | answer | missed (answer) |
| svc-kn-en-408 | settled | ನನಗೆ ಹೊಸ savings account ಬೇಕು | start:open new account | clarify | missed (clarify) |
| svc-rom-hi-405 | settled | mujhe naya bank account chahiye | start:open new account | clarify | missed (clarify) |
| amb-hi-en-401 | settled | bank का काम है | clarify | answer | no_start_other_reply (answer) |
| amb-rom-hi-401 | settled | paise chahiye | clarify | no-start:CONTROL | no_start_other_reply (no-start:CONTROL) |
| amb-rom-kn-401 | settled | duddu beku | clarify | no-start:ACKNOWLEDGEMENT | no_start_other_reply (no-start:ACKNOWLEDGEMENT) |
