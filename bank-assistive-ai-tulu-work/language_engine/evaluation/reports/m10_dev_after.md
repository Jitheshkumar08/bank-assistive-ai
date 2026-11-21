# M10 routing evaluation: m10_dev_after

Fixtures: `m10_dev.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 104 | 24 | 46/52 | 0 | 0/42 | 0 | 9/13 | 22/22 | 22/22 | 0/0 | 0/14 |
| pending policy | 4 | 1 | 0/0 | 0 | 0/4 | 0 | 2/2 | 1/2 | 2/2 | 0/0 | 0/1 |
| family: amount | 6 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: balance_direct | 10 | 1 | 10/10 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: balance_paraphrase | 4 | 8 | 3/4 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: control | 4 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: deposit | 15 | 0 | 14/15 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: loan | 4 | 0 | 4/4 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: open_account | 4 | 0 | 4/4 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: problem_with_request | 4 | 0 | 1/4 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: refusal | 7 | 0 | 0/0 | 0 | 0/7 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: service_question | 0 | 14 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/14 |
| family: unsupported | 22 | 0 | 0/0 | 0 | 0/22 | 0 | 0/0 | 22/22 | 22/22 | 0/0 | 0/0 |
| family: vague | 13 | 0 | 0/0 | 0 | 0/13 | 0 | 9/13 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: withdraw | 11 | 1 | 10/11 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 23 | 10 | 10/10 | 0 | 0/11 | 0 | 1/3 | 7/7 | 7/7 | 0/0 | 0/5 |
| lang: kn | 21 | 3 | 10/11 | 0 | 0/7 | 0 | 3/3 | 3/3 | 3/3 | 0/0 | 0/2 |
| lang: hi | 20 | 5 | 8/9 | 0 | 0/9 | 0 | 3/3 | 4/4 | 4/4 | 0/0 | 0/3 |
| lang: kn-en | 13 | 2 | 5/7 | 0 | 0/5 | 0 | 1/1 | 3/3 | 3/3 | 0/0 | 0/1 |
| lang: hi-en | 13 | 2 | 6/7 | 0 | 0/5 | 0 | 1/1 | 3/3 | 3/3 | 0/0 | 0/1 |
| lang: rom-kn | 7 | 1 | 3/4 | 0 | 0/3 | 0 | 0/1 | 1/1 | 1/1 | 0/0 | 0/1 |
| lang: rom-hi | 7 | 1 | 4/4 | 0 | 0/2 | 0 | 0/1 | 1/1 | 1/1 | 0/0 | 0/1 |

## Every row not correct

| id | policy | text | expected | decision | outcome |
|---|---|---|---|---|---|
| svc-en-1001 | settled | could you look up the balance on my account | start:check account balance | llm_gate | llm_gated |
| svc-en-1004 | settled | how much money do I have in my account | start:check account balance | llm_gate | llm_gated |
| svc-en-1005 | settled | can you tell me how much is left in my savings account | start:check account balance | llm_gate | llm_gated |
| svc-en-1006 | settled | do I have at least five thousand rupees in my account | start:check account balance | llm_gate | llm_gated |
| svc-kn-1003 | settled | ಉಳಿತಾಯ ಖಾತೆಯಲ್ಲಿ ಎಷ್ಟು ಹಣ ಇದೆ ಅಂತ ಹೇಳ್ತೀರಾ | start:check account balance | llm_gate | llm_gated |
| svc-kn-en-1003 | settled | ನನ್ನ ಅಕೌಂಟಲ್ಲಿ ಸಾವಿರ ರೂಪಾಯಿ ಆದರೂ ಇದೆಯಾ | start:check account balance | llm_gate | llm_gated |
| svc-hi-1003 | settled | बताइए मेरे बचत खाते में कितनी रकम है | start:check account balance | llm_gate | llm_gated |
| svc-hi-1004 | settled | क्या मेरे खाते में दस हज़ार रुपये हैं | start:check account balance | llm_gate | llm_gated |
| svc-hi-en-1003 | settled | मेरे अकाउंट में कितने रुपये पड़े हैं | start:check account balance | llm_gate | llm_gated |
| svc-rom-kn-1002 | settled | nanna khateli eshtu duddu ide | start:check account balance | clarify | missed (clarify) |
| svc-kn-en-1004 | settled | ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್ ಮಾಡೋದಿದೆ | start:deposit money | answer | missed (answer) |
| svc-en-1012 | settled | can I get two thousand in cash from my savings account | start:withdraw money | llm_gate | llm_gated |
| svc-kn-en-1007 | settled | ಅಕೌಂಟಿಂದ ಎರಡು ಸಾವಿರ ಡ್ರಾ ಮಾಡ್ಬೇಕು | start:withdraw money | answer | missed (answer) |
| kq-en-1001 | settled | how do I fill in a deposit slip | question | llm_gate | llm_gated |
| kq-en-1002 | settled | what is the maximum amount I can withdraw in one day | question | llm_gate | llm_gated |
| kq-en-1003 | settled | what interest does a fixed deposit earn | question | llm_gate | llm_gated |
| kq-en-1004 | settled | is there a charge for withdrawing cash at the branch | question | llm_gate | llm_gated |
| kq-en-1005 | settled | which documents are required for opening a savings account | question | llm_gate | llm_gated |
| kq-kn-1001 | settled | ಹಣ ಜಮಾ ಮಾಡೋಕೆ ಯಾವ ಫಾರ್ಮ್ ತುಂಬಬೇಕು | question | llm_gate | llm_gated |
| kq-kn-1002 | settled | ಒಂದು ದಿನದಲ್ಲಿ ಗರಿಷ್ಠ ಎಷ್ಟು ಹಣ ತೆಗೆಯಬಹುದು | question | llm_gate | llm_gated |
| kq-kn-en-1001 | settled | ಲೋನ್ ಗೆ ಅಪ್ಲೈ ಮಾಡೋದು ಹೇಗೆ | question | llm_gate | llm_gated |
| kq-hi-1001 | settled | पैसे जमा करने की प्रक्रिया क्या है | question | llm_gate | llm_gated |
| kq-hi-1002 | settled | लोन पर ब्याज कितना लगता है | question | llm_gate | llm_gated |
| kq-hi-1003 | settled | खाता खोलने के लिए न्यूनतम कितनी राशि चाहिए | question | llm_gate | llm_gated |
| kq-hi-en-1001 | settled | अकाउंट ओपन करने के लिए कौन से डॉक्यूमेंट चाहिए | question | llm_gate | llm_gated |
| kq-rom-kn-1001 | settled | loan ge yaava documents beku | question | llm_gate | llm_gated |
| kq-rom-hi-1001 | settled | paise nikalne ki limit kitni hai | question | llm_gate | llm_gated |
| amb-kn-1004 | pending | ಗೂಗಲ್ ಪೇ ಮೂಲಕ ಗೃಹ ಸಾಲದ ಕಂತು ಕಟ್ಟಬಹುದಾ | decline | llm_gate | llm_gated |
| amb-hi-1005 | pending | पेटीएम वॉलेट में अपने खाते से पाँच सौ रुपये डालने हैं | decline | clarify | no_start_other_reply (clarify) |
| amb-en-1010 | settled | I have a question about my account | clarify | answer | no_start_other_reply (answer) |
| amb-en-1011 | settled | I need some help with the bank | clarify | answer | no_start_other_reply (answer) |
| amb-rom-kn-1002 | settled | duddu | clarify | no-start:CONTROL | no_start_other_reply (no-start:CONTROL) |
| amb-rom-hi-1002 | settled | paise ka kaam hai | clarify | answer | no_start_other_reply (answer) |
| svc-kn-1012 | settled | ಎಟಿಎಂ ಕಾರ್ಡ್ ಕೆಲಸ ಮಾಡ್ತಿಲ್ಲ ಕೌಂಟರಲ್ಲೇ ಹಣ ತೆಗೆಯಬೇಕು | start:withdraw money | refused | missed (refused) |
| svc-hi-en-1008 | settled | एटीएम से नहीं यहीं काउंटर से पैसे निकालने हैं | start:withdraw money | refused | missed (refused) |
| svc-hi-1011 | settled | पासबुक नहीं है लेकिन पैसे जमा करने हैं | start:deposit money | refused | missed (refused) |
| amt-en-1001 | settled | um twelve hundred rupees | amount:1200 | clarify | missed_amount |
| amt-rom-hi-1001 | settled | paanch sau rupaye | amount:500 | answer | missed_amount |
| ctl-kn-1001 | settled | ಸ್ವಲ್ಪ ನಿಲ್ಲಿಸಿ | control:pause | no-start:CONTROL | missed_command |
| ctl-hi-1001 | settled | फिर से बोलिए | control:repeat | no-start:CONTROL | missed_command |
| ctl-en-1001 | settled | cancel that please | control:cancel | no-start:CONTROL | missed_command |
| ctl-kn-1002 | settled | ಮುಂದೆ ಹೋಗೋಣ | control:resume | no-start:CONTROL | missed_command |
