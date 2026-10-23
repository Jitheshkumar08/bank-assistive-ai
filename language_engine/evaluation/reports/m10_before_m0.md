# M10 routing evaluation: m10_before_m0

Fixtures: `multilingual_v1.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 58 | 38 | 53/57 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 20/38 |
| pending policy | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: knowledge_question | 1 | 38 | 0/0 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 20/38 |
| family: service_request | 57 | 0 | 53/57 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 11 | 7 | 10/10 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 2/7 |
| lang: kn | 11 | 9 | 10/11 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 7/9 |
| lang: hi | 8 | 7 | 8/8 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 4/7 |
| lang: kn-en | 10 | 5 | 10/10 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 3/5 |
| lang: hi-en | 8 | 4 | 8/8 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/4 |
| lang: rom-kn | 5 | 3 | 4/5 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/3 |
| lang: rom-hi | 5 | 3 | 3/5 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 2/3 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| svc-kn-11 | settled | ನಾನು ಉಳಿತಾಯ ಖಾತೆ ತೆರೆಯಬೇಕು | start:open new account | answer | missed (answer) |
| svc-rom-hi-02 | settled | paise jama karne hai | start:deposit money | answer | missed (answer) |
| svc-rom-hi-03 | settled | paise nikalne hai | start:withdraw money | clarify | missed (clarify) |
| svc-rom-kn-04 | settled | nanage hana tegeyabeku | start:withdraw money | answer | missed (answer) |
| kq-en-01 | settled | What is a savings account? | question | llm_gate | llm_gated |
| kq-en-02 | settled | what documents are required for a home loan | question | llm_gate | llm_gated |
| kq-en-03 | settled | how do I open a savings account | question | llm_gate | llm_gated |
| kq-en-04 | settled | what is a deposit slip | question | llm_gate | llm_gated |
| kq-en-05 | settled | what is a cheque book used for | question | llm_gate | llm_gated |
| kq-en-07 | settled | tell me about fixed deposit interest | question | llm_gate | llm_gated |
| kq-en-08 | settled | who won the cricket match yesterday | question | llm_gate | llm_gated |
| kq-kn-01 | settled | ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು | question | llm_gate | llm_gated |
| kq-kn-02 | settled | ಖಾತೆ ತೆರೆಯುವುದು ಹೇಗೆ | question | llm_gate | llm_gated |
| kq-kn-03 | settled | ಖಾತೆ ತೆರೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-04 | settled | ಸಾಲಕ್ಕೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-05 | settled | ಸಾಲ ಪಡೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-06 | settled | ಹಣ ಜಮಾ ಮಾಡುವುದು ಹೇಗೆ | question | llm_gate | llm_gated |
| kq-kn-07 | settled | ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು | question | llm_gate | llm_gated |
| kq-kn-08 | settled | ನನಗೆ ಖಾತೆ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ | question | llm_gate | llm_gated |
| kq-kn-09 | settled | ಇಂದು ಹವಾಮಾನ ಹೇಗಿದೆ | question | llm_gate | llm_gated |
| kq-hi-01 | settled | बचत खाता क्या है | question | llm_gate | llm_gated |
| kq-hi-02 | settled | नया खाता कैसे खोलें | question | llm_gate | llm_gated |
| kq-hi-03 | settled | शिक्षा ऋण क्या है | question | llm_gate | llm_gated |
| kq-hi-04 | settled | जमा पर्ची क्या होती है | question | llm_gate | llm_gated |
| kq-hi-05 | settled | खाता खोलने के लिए क्या चाहिए | question | llm_gate | llm_gated |
| kq-hi-06 | settled | पैसे जमा कैसे करते हैं | question | llm_gate | llm_gated |
| kq-hi-07 | settled | आज मौसम कैसा है | question | llm_gate | llm_gated |
| kq-kn-en-01 | settled | ನನಗೆ ಲೋನ್ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನು | question | llm_gate | llm_gated |
| kq-kn-en-02 | settled | ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು | question | llm_gate | llm_gated |
| kq-kn-en-03 | settled | ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಬಗ್ಗೆ ಮಾಹಿತಿ ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-en-04 | settled | loan ಗೆ ಯಾವ documents ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-en-05 | settled | cheque book ಅಂದರೆ ಏನು | question | llm_gate | llm_gated |
| kq-hi-en-01 | settled | लोन के लिए कौन से दस्तावेज़ चाहिए | question | llm_gate | llm_gated |
| kq-hi-en-02 | settled | बैलेंस कैसे चेक करें | question | llm_gate | llm_gated |
| kq-hi-en-03 | settled | loan के लिए कौन से documents चाहिए | question | llm_gate | llm_gated |
| kq-hi-en-04 | settled | cheque book क्या होती है | question | llm_gate | llm_gated |
| kq-rom-hi-01 | settled | loan ke liye kya documents chahiye | question | llm_gate | llm_gated |
| kq-rom-hi-02 | settled | savings account kya hota hai | question | llm_gate | llm_gated |
| kq-rom-hi-03 | settled | account kaise kholte hai | question | llm_gate | llm_gated |
| kq-rom-kn-01 | settled | loan tegeyalu yaava documents beku | question | llm_gate | llm_gated |
| kq-rom-kn-02 | settled | savings account andre enu | question | llm_gate | llm_gated |
| kq-rom-kn-03 | settled | account hege open madodu | question | llm_gate | llm_gated |
