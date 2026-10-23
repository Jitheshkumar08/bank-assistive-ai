# M10 routing evaluation: m10_after_m7

Fixtures: `m7_fresh.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 6 | 54 | 0/0 | 0 | 0/6 | 0 | 0/0 | 0/0 | 0/0 | 1/6 | 9/54 |
| pending policy | 0 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: knowledge_question | 6 | 54 | 0/0 | 0 | 0/6 | 0 | 0/0 | 0/0 | 0/0 | 1/6 | 9/54 |
| lang: en | 0 | 9 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 3/9 |
| lang: kn | 1 | 8 | 0/0 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 0/1 | 1/8 |
| lang: hi | 1 | 8 | 0/0 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 0/1 | 1/8 |
| lang: kn-en | 1 | 7 | 0/0 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 0/1 | 1/7 |
| lang: hi-en | 1 | 7 | 0/0 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 1/1 | 1/7 |
| lang: rom-kn | 1 | 7 | 0/0 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 0/1 | 1/7 |
| lang: rom-hi | 1 | 8 | 0/0 | 0 | 0/1 | 0 | 0/0 | 0/0 | 0/0 | 0/1 | 1/8 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| kq-en-710 | settled | how do I fill a withdrawal slip | question | llm_gate | llm_gated |
| kq-kn-710 | settled | ಹಣ ತೆಗೆಯುವ ಚೀಟಿಯನ್ನು ಹೇಗೆ ತುಂಬಬೇಕು | question | llm_gate | llm_gated |
| kq-hi-710 | settled | निकासी पर्ची कैसे भरें | question | llm_gate | llm_gated |
| kq-kn-en-710 | settled | withdrawal slip ಹೇಗೆ ತುಂಬುವುದು | question | llm_gate | llm_gated |
| kq-hi-en-710 | settled | withdrawal slip कैसे भरते हैं | question | llm_gate | llm_gated |
| kq-rom-hi-710 | settled | withdrawal slip kaise bharte hain | question | llm_gate | llm_gated |
| kq-rom-kn-710 | settled | withdrawal slip hege tumbodu | question | llm_gate | llm_gated |
| kq-en-720 | settled | why is my account number important | question | llm_gate | llm_gated |
| kq-kn-720 | settled | ಖಾತೆ ಸಂಖ್ಯೆ ಏಕೆ ಮುಖ್ಯ | question | llm_gate | llm_gated |
| kq-hi-720 | settled | खाता संख्या क्यों ज़रूरी है | question | llm_gate | llm_gated |
| kq-kn-en-720 | settled | account number ಯಾಕೆ ಬೇಕು | question | llm_gate | llm_gated |
| kq-hi-en-720 | settled | account number क्यों चाहिए | question | llm_gate | llm_gated |
| kq-rom-hi-720 | settled | account number kyon zaroori hai | question | llm_gate | llm_gated |
| kq-rom-kn-720 | settled | account number yaake beku | question | llm_gate | llm_gated |
| kq-en-730 | settled | how can I send money to another account | question | llm_gate | llm_gated |
| kq-kn-730 | settled | ಬೇರೆ ಖಾತೆಗೆ ಹಣ ಹೇಗೆ ಕಳುಹಿಸುವುದು | question | llm_gate | llm_gated |
| kq-hi-730 | settled | दूसरे खाते में पैसे कैसे भेजें | question | llm_gate | llm_gated |
| kq-kn-en-730 | settled | ಬೇರೆ account ಗೆ money transfer ಹೇಗೆ ಮಾಡುವುದು | question | llm_gate | llm_gated |
| kq-hi-en-730 | settled | दूसरे account में पैसे transfer कैसे करें | question | llm_gate | llm_gated |
| kq-rom-hi-730 | settled | dusre account mein paise kaise bheje | question | llm_gate | llm_gated |
| kq-rom-kn-730 | settled | bere account ge hana hege kalisodu | question | llm_gate | llm_gated |
| kq-en-740 | settled | what services does a bank branch offer | question | llm_gate | llm_gated |
| kq-kn-740 | settled | ಬ್ಯಾಂಕ್ ಶಾಖೆಯಲ್ಲಿ ಯಾವ ಸೇವೆಗಳು ಸಿಗುತ್ತವೆ | question | llm_gate | llm_gated |
| kq-hi-740 | settled | बैंक शाखा में कौन सी सेवाएँ मिलती हैं | question | llm_gate | llm_gated |
| kq-kn-en-740 | settled | bank branch ನಲ್ಲಿ ಯಾವ services ಇವೆ | question | llm_gate | llm_gated |
| kq-hi-en-740 | settled | bank branch में कौन सी services मिलती हैं | question | llm_gate | llm_gated |
| kq-rom-hi-740 | settled | bank mein kaun si sevaayein milti hain | question | llm_gate | llm_gated |
| kq-rom-kn-740 | settled | bank alli yaava sevegalu sigutte | question | llm_gate | llm_gated |
| kq-en-750 | settled | who should open a current account | question | llm_gate | llm_gated |
| kq-kn-750 | settled | ಚಾಲ್ತಿ ಖಾತೆ ಯಾರಿಗೆ ಸೂಕ್ತ | question | clarify | no_start_other_reply (clarify) |
| kq-hi-750 | settled | चालू खाता किसके लिए होता है | question | clarify | no_start_other_reply (clarify) |
| kq-kn-en-750 | settled | current account ಯಾರಿಗೆ ಉಪಯೋಗ | question | clarify | no_start_other_reply (clarify) |
| kq-rom-hi-750 | settled | current account kiske liye hota hai | question | clarify | no_start_other_reply (clarify) |
| kq-rom-kn-750 | settled | current account yaarige beku | question | clarify | no_start_other_reply (clarify) |
| kq-en-760 | settled | what does a passbook show | question | llm_gate | llm_gated |
| kq-kn-760 | settled | ಖಾತೆ ಪುಸ್ತಕದಲ್ಲಿ ಏನು ಇರುತ್ತದೆ | question | llm_gate | llm_gated |
| kq-hi-760 | settled | खाता पुस्तिका में क्या दर्ज होता है | question | llm_gate | llm_gated |
| kq-kn-en-760 | settled | passbook ನಲ್ಲಿ ಏನು ಇರುತ್ತದೆ | question | llm_gate | llm_gated |
| kq-hi-en-760 | settled | passbook में क्या होता है | question | llm_gate | llm_gated |
| kq-rom-hi-760 | settled | passbook mein kya hota hai | question | llm_gate | llm_gated |
| kq-rom-kn-760 | settled | passbook nalli enu irutte | question | llm_gate | llm_gated |
| kq-en-770 | settled | which ID proofs are needed for a new account | question | llm_gate | llm_gated |
| kq-kn-770 | settled | ಹೊಸ ಖಾತೆಗೆ ಯಾವ ಗುರುತಿನ ಚೀಟಿಗಳು ಬೇಕು | question | llm_gate | llm_gated |
| kq-hi-770 | settled | नए खाते के लिए कौन से पहचान पत्र चाहिए | question | llm_gate | llm_gated |
| kq-kn-en-770 | settled | new account ಗೆ ಯಾವ ID proof ಬೇಕು | question | llm_gate | llm_gated |
| kq-hi-en-770 | settled | new account के लिए कौन सा ID proof चाहिए | question | llm_gate | llm_gated |
| kq-rom-hi-770 | settled | naye khate ke liye kaun se documents chahiye | question | llm_gate | llm_gated |
| kq-rom-kn-770 | settled | hosa khate ge yaava documents beku | question | llm_gate | llm_gated |
| kq-en-780 | settled | what are the steps to get a loan | question | llm_gate | llm_gated |
| kq-kn-780 | settled | ಸಾಲ ಪಡೆಯುವ ಪ್ರಕ್ರಿಯೆ ಏನು | question | llm_gate | llm_gated |
| kq-hi-780 | settled | ऋण लेने की प्रक्रिया क्या है | question | llm_gate | llm_gated |
| kq-kn-en-780 | settled | loan ತೆಗೆದುಕೊಳ್ಳುವ process ಏನು | question | llm_gate | llm_gated |
| kq-hi-en-780 | settled | loan लेने का process क्या है | question | llm_gate | llm_gated |
| kq-rom-hi-780 | settled | loan lene ka tarika kya hai | question | llm_gate | llm_gated |
| kq-rom-kn-780 | settled | loan tegedukolluva vidhana enu | question | llm_gate | llm_gated |
| kq-en-791 | settled | what is today's gold rate | question | llm_gate | llm_gated |
| kq-kn-792 | settled | ಇಂದಿನ ಚಿನ್ನದ ಬೆಲೆ ಎಷ್ಟು | question | llm_gate | llm_gated |
| kq-hi-793 | settled | म्यूचुअल फंड में निवेश कैसे करें | question | llm_gate | llm_gated |
| kq-rom-hi-794 | settled | share market kaise kaam karta hai | question | llm_gate | llm_gated |
