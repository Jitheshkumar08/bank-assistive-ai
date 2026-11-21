# M10 routing evaluation: m10_policy_m3

Fixtures: `m3_language_cues.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline; `approved:Dn` rows count in it.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 31 | 25 | 12/12 | 0 | 0/19 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 9/24 |
| of which approved-policy rows (D1/D3/D5) | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| pending policy | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: knowledge_question | 0 | 24 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 9/24 |
| family: refusal | 19 | 0 | 0/0 | 0 | 0/19 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: service_request | 12 | 1 | 12/12 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 3 | 0 | 1/1 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: kn | 9 | 6 | 4/4 | 0 | 0/5 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 2/6 |
| lang: hi | 5 | 5 | 2/2 | 0 | 0/3 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/4 |
| lang: kn-en | 3 | 4 | 1/1 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 2/4 |
| lang: hi-en | 3 | 4 | 1/1 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/4 |
| lang: rom-kn | 3 | 3 | 1/1 | 0 | 0/2 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 3/3 |
| lang: rom-hi | 5 | 3 | 2/2 | 0 | 0/3 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 1/3 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| kq-kn-301 | settled | ಖಾತೆ ತೆರೆಯಲು ಏನು ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-302 | settled | ಉಳಿತಾಯ ಖಾತೆ ತೆರೆಯಲು ಬೇಕಾದ ದಾಖಲೆಗಳು | question | llm_gate | llm_gated |
| kq-kn-303 | settled | ಬ್ಯಾಂಕ್ ಯಾಕೆ ಬಡ್ಡಿ ಕೊಡುತ್ತದೆ | question | llm_gate | llm_gated |
| kq-kn-304 | settled | ಠೇವಣಿ ಚೀಟಿ ಎಲ್ಲಿ ಸಿಗುತ್ತದೆ | question | llm_gate | llm_gated |
| kq-kn-305 | settled | ಸಾಲದ ಬಡ್ಡಿ ದರ ಎಷ್ಟು | question | llm_gate | llm_gated |
| kq-kn-306 | settled | ಸಾಲದ ಬಗ್ಗೆ ಮಾಹಿತಿ ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-en-301 | settled | ಹಣ ತೆಗೆಯಲು ಪಾಸ್‌ಬುಕ್ ಬೇಕಾ | question | llm_gate | llm_gated |
| kq-kn-en-302 | settled | ಚೆಕ್ ಬುಕ್ ಪಡೆಯುವುದು ಹೇಗೆ | question | llm_gate | llm_gated |
| kq-kn-en-303 | settled | account open ಮಾಡಲು ಏನು ಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-en-304 | settled | ಲೋನ್ ಇಂಟರೆಸ್ಟ್ ರೇಟ್ ಎಷ್ಟು | question | llm_gate | llm_gated |
| kq-hi-301 | settled | बैंक ब्याज क्यों देता है | question | llm_gate | llm_gated |
| kq-hi-302 | settled | जमा पर्ची कहाँ मिलेगी | question | llm_gate | llm_gated |
| kq-hi-303 | settled | खाता खोलने के लिए कौन से दस्तावेज़ चाहिए | question | llm_gate | llm_gated |
| kq-hi-304 | settled | बचत खाते के बारे में जानकारी चाहिए | question | llm_gate | llm_gated |
| kq-hi-en-301 | settled | बै लेंस कैसे चेक करें | question | llm_gate | llm_gated |
| kq-hi-en-302 | settled | लोन की ब्याज दर कितनी है | question | llm_gate | llm_gated |
| kq-hi-en-303 | settled | पैसे निकालने के लिए पासबुक चाहिए क्या | question | llm_gate | llm_gated |
| kq-hi-en-304 | settled | account open करने के लिए क्या चाहिए | question | llm_gate | llm_gated |
| kq-rom-hi-301 | settled | balance kaise check kare | question | llm_gate | llm_gated |
| kq-rom-hi-302 | settled | loan ka interest kitna hai | question | llm_gate | llm_gated |
| kq-rom-hi-303 | settled | account kholne ke liye kya chahiye | question | llm_gate | llm_gated |
| kq-rom-kn-301 | settled | account open madalu enu beku | question | llm_gate | llm_gated |
| kq-rom-kn-302 | settled | loan bagge mahiti beku | question | llm_gate | llm_gated |
| kq-rom-kn-303 | settled | deposit slip elli sigutte | question | llm_gate | llm_gated |
| svc-hi-303 | settled | क्या मैं पैसे निकाल सकता हूँ | start:withdraw money | llm_gate | llm_gated |
