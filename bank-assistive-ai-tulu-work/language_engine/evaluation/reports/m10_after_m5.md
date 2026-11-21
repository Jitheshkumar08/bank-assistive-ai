# M10 routing evaluation: m10_after_m5

Fixtures: `m5_fresh.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 40 | 2 | 23/26 | 0 | 0/14 | 0 | 3/4 | 0/0 | 0/0 | 6/6 | 0/2 |
| pending policy | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: ambiguous_request | 4 | 0 | 0/0 | 0 | 0/4 | 0 | 3/4 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: knowledge_question | 6 | 2 | 0/0 | 0 | 0/6 | 0 | 0/0 | 0/0 | 0/0 | 6/6 | 0/2 |
| family: refusal | 4 | 0 | 0/0 | 0 | 0/4 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: service_request | 26 | 0 | 23/26 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 6 | 0 | 3/3 | 0 | 0/3 | 0 | 1/1 | 0/0 | 0/0 | 1/1 | 0/0 |
| lang: kn | 5 | 0 | 2/2 | 0 | 0/3 | 0 | 1/2 | 0/0 | 0/0 | 1/1 | 0/0 |
| lang: hi | 6 | 0 | 3/4 | 0 | 0/2 | 0 | 1/1 | 0/0 | 0/0 | 1/1 | 0/0 |
| lang: kn-en | 8 | 1 | 5/6 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 0/1 |
| lang: hi-en | 7 | 1 | 5/5 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 0/1 |
| lang: rom-kn | 3 | 0 | 3/3 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: rom-hi | 5 | 0 | 2/3 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 0/0 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| svc-kn-en-504 | settled | ಬ್ಯಾಲೆನ್ಸ್‌ ಚೆಕ್ ಮಾಡಬೇಕಿತ್ತು | start:check account balance | answer | missed (answer) |
| svc-rom-hi-502 | settled | mujhe lone chahiye | start:apply for loan | answer | missed (answer) |
| svc-hi-504 | settled | खाते में बची राशि दिखाइए | start:check account balance | answer | missed (answer) |
| kq-kn-en-502 | settled | ಚೆಕ್ ಬುಕ್ ಹೇಗೆ ಪಡೆಯುವುದು | question | llm_gate | llm_gated |
| kq-hi-en-502 | settled | एकाउंट कैसे खोलें। | question | llm_gate | llm_gated |
| amb-kn-502 | settled | ಬ್ಯಾಂಕಿನಲ್ಲಿ ಸ್ವಲ್ಪ ಕೆಲಸ ಇದೆ | clarify | answer | no_start_other_reply (answer) |
