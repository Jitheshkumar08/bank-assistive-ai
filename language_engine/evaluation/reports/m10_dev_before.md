# M10 routing evaluation: m10_dev_before

Fixtures: `m10_dev.json`. Text only, offline, no LLM: LLM-gated rows are not scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open policy decision and are kept out of the headline.

| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **all settled** | 104 | 24 | 41/52 | 6 | 24/42 | 20 | 0/13 | 2/22 | 7/22 | 0/0 | 10/14 |
| pending policy | 4 | 1 | 0/0 | 0 | 4/4 | 2 | 0/2 | 0/2 | 0/2 | 0/0 | 1/1 |
| family: amount | 6 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: balance_direct | 10 | 1 | 10/10 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: balance_paraphrase | 4 | 8 | 2/4 | 2 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: control | 4 | 0 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: deposit | 15 | 0 | 11/15 | 3 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: loan | 4 | 0 | 4/4 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: open_account | 4 | 0 | 4/4 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: problem_with_request | 4 | 0 | 1/4 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: refusal | 7 | 0 | 0/0 | 0 | 0/7 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: service_question | 0 | 14 | 0/0 | 0 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 10/14 |
| family: unsupported | 22 | 0 | 0/0 | 0 | 15/22 | 15 | 0/0 | 2/22 | 7/22 | 0/0 | 0/0 |
| family: vague | 13 | 0 | 0/0 | 0 | 9/13 | 5 | 0/13 | 0/0 | 0/0 | 0/0 | 0/0 |
| family: withdraw | 11 | 1 | 9/11 | 1 | 0/0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| lang: en | 23 | 10 | 10/10 | 0 | 6/11 | 6 | 0/3 | 0/7 | 2/7 | 0/0 | 4/5 |
| lang: kn | 21 | 3 | 9/11 | 1 | 6/7 | 5 | 0/3 | 0/3 | 0/3 | 0/0 | 2/2 |
| lang: hi | 20 | 5 | 7/9 | 1 | 6/9 | 5 | 0/3 | 0/4 | 1/4 | 0/0 | 2/3 |
| lang: kn-en | 13 | 2 | 4/7 | 1 | 3/5 | 2 | 0/1 | 0/3 | 1/3 | 0/0 | 1/1 |
| lang: hi-en | 13 | 2 | 6/7 | 0 | 2/5 | 1 | 0/1 | 1/3 | 2/3 | 0/0 | 1/1 |
| lang: rom-kn | 7 | 1 | 3/4 | 1 | 1/3 | 1 | 0/1 | 0/1 | 0/1 | 0/0 | 0/1 |
| lang: rom-hi | 7 | 1 | 2/4 | 2 | 0/2 | 0 | 0/1 | 1/1 | 1/1 | 0/0 | 0/1 |

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
| svc-rom-hi-1002 | settled | mere khate mein kitne paise bache hain | start:check account balance | start:open new account | wrong_service |
| svc-rom-kn-1002 | settled | nanna khateli eshtu duddu ide | start:check account balance | start:withdraw money | wrong_service |
| svc-kn-en-1004 | settled | ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್ ಮಾಡೋದಿದೆ | start:deposit money | answer | missed (answer) |
| svc-kn-en-1005 | settled | ನನ್ನ ಅಕೌಂಟ್ಗೆ ಹತ್ತು ಸಾವಿರ ಕ್ಯಾಶ್ ಹಾಕಬೇಕು | start:deposit money | start:check account balance | wrong_service |
| svc-hi-1006 | settled | अपने सेविंग खाते में थोड़ी रकम डलवानी है | start:deposit money | start:check account balance | wrong_service |
| svc-rom-hi-1003 | settled | khate mein do hazaar daalne hain | start:deposit money | start:open new account | wrong_service |
| svc-en-1012 | settled | can I get two thousand in cash from my savings account | start:withdraw money | llm_gate | llm_gated |
| svc-kn-1008 | settled | ನನ್ನ ಖಾತೆಯಿಂದ ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಬಿಡಿಸಿಕೊಳ್ಳಬೇಕು | start:withdraw money | start:check account balance | wrong_service |
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
| amb-en-1001 | settled | send two thousand rupees to my brother | decline | start:withdraw money | false_start |
| amb-en-1002 | settled | I want to pay my electricity bill | decline | start:apply for loan | false_start |
| amb-en-1003 | settled | please block my debit card | decline | answer | no_start_other_reply (answer) |
| amb-en-1004 | settled | recharge my mobile for two hundred and ninety nine rupees | decline | answer | no_start_other_reply (answer) |
| amb-en-1005 | settled | transfer five thousand to my wife's account | decline | start:withdraw money | false_start |
| amb-en-1006 | settled | I want to buy health insurance | decline | start:deposit money | false_start |
| amb-en-1007 | settled | I want to invest in a mutual fund | decline | start:deposit money | false_start |
| amb-en-1008 | pending | add one thousand rupees to my Paytm wallet from my bank account | decline | start:deposit money | false_start |
| amb-kn-1001 | settled | ನನ್ನ ತಮ್ಮನಿಗೆ ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಕಳಿಸಬೇಕು | decline | start:deposit money | false_start |
| amb-kn-1002 | settled | ಕರೆಂಟ್ ಬಿಲ್ ಕಟ್ಟಬೇಕು | decline | start:withdraw money | false_start |
| amb-kn-1003 | settled | ನನಗೆ ಆರೋಗ್ಯ ವಿಮೆ ಬೇಕು | decline | start:deposit money | false_start |
| amb-kn-en-1001 | settled | ನನ್ನ ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ ಬ್ಲಾಕ್ ಮಾಡಿ | decline | answer | no_start_other_reply (answer) |
| amb-kn-en-1002 | settled | ಯುಪಿಐ ಪಿನ್ ಮರೆತುಹೋಗಿದೆ ರೀಸೆಟ್ ಮಾಡಿ | decline | start:withdraw money | false_start |
| amb-kn-en-1003 | settled | ಫೋನ್‌ಪೇ ಮೂಲಕ ಹಣ ಟ್ರಾನ್ಸ್‌ಫರ್ ಮಾಡಬೇಕು | decline | start:withdraw money | false_start |
| amb-hi-1001 | settled | मेरे भाई के खाते में तीन हज़ार रुपये भेज दो | decline | start:deposit money | false_start |
| amb-hi-1002 | settled | बिजली का बिल भरना है | decline | start:apply for loan | false_start |
| amb-hi-1003 | settled | मुझे जीवन बीमा लेना है | decline | start:withdraw money | false_start |
| amb-hi-1004 | settled | म्यूचुअल फंड में निवेश करना है | decline | answer | no_start_other_reply (answer) |
| amb-hi-en-1001 | settled | गूगल पे से पैसे भेजने हैं | decline | start:deposit money | false_start |
| amb-hi-en-1003 | settled | मोबाइल रिचार्ज करना है | decline | answer | no_start_other_reply (answer) |
| amb-rom-kn-1001 | settled | phonepe inda duddu kalisbeku | decline | start:deposit money | false_start |
| amb-kn-1004 | pending | ಗೂಗಲ್ ಪೇ ಮೂಲಕ ಗೃಹ ಸಾಲದ ಕಂತು ಕಟ್ಟಬಹುದಾ | decline | llm_gate | llm_gated |
| amb-hi-1005 | pending | पेटीएम वॉलेट में अपने खाते से पाँच सौ रुपये डालने हैं | decline | start:withdraw money | false_start |
| amb-en-1009 | settled | money | clarify | start:deposit money | false_start |
| amb-en-1010 | settled | I have a question about my account | clarify | answer | no_start_other_reply (answer) |
| amb-en-1011 | settled | I need some help with the bank | clarify | answer | no_start_other_reply (answer) |
| amb-kn-1005 | settled | ದುಡ್ಡು | clarify | start:deposit money | false_start |
| amb-kn-1006 | settled | ಖಾತೆ ವಿಚಾರ ಒಂದು ಕೇಳಬೇಕಿತ್ತು | clarify | start:withdraw money | false_start |
| amb-kn-1007 | settled | ನನಗೆ ಬ್ಯಾಂಕ್ ವಿಷಯದಲ್ಲಿ ಸ್ವಲ್ಪ ಸಹಾಯ ಬೇಕು | clarify | start:check account balance | false_start |
| amb-kn-en-1004 | settled | ನನ್ನ ಅಕೌಂಟ್ ಸಮಸ್ಯೆ ಇದೆ | clarify | start:check account balance | false_start |
| amb-hi-1006 | settled | पैसे | clarify | start:deposit money | false_start |
| amb-hi-1007 | settled | मेरे खाते का एक काम है | clarify | start:check account balance | false_start |
| amb-hi-1008 | settled | बस सात सौ रुपये | clarify | start:withdraw money | false_start |
| amb-hi-en-1004 | settled | अकाउंट का कुछ काम था | clarify | start:check account balance | false_start |
| amb-rom-kn-1002 | settled | duddu | clarify | no-start:CONTROL | no_start_other_reply (no-start:CONTROL) |
| amb-rom-hi-1002 | settled | paise ka kaam hai | clarify | answer | no_start_other_reply (answer) |
| amb-en-1012 | pending | transfer some money and check my balance | clarify | start:check account balance | false_start |
| amb-hi-1009 | pending | मेरा बैलेंस बताओ और भाई को पैसे भेज दो | clarify | start:check account balance | false_start |
| svc-kn-1012 | settled | ಎಟಿಎಂ ಕಾರ್ಡ್ ಕೆಲಸ ಮಾಡ್ತಿಲ್ಲ ಕೌಂಟರಲ್ಲೇ ಹಣ ತೆಗೆಯಬೇಕು | start:withdraw money | refused | missed (refused) |
| svc-hi-en-1008 | settled | एटीएम से नहीं यहीं काउंटर से पैसे निकालने हैं | start:withdraw money | refused | missed (refused) |
| svc-hi-1011 | settled | पासबुक नहीं है लेकिन पैसे जमा करने हैं | start:deposit money | refused | missed (refused) |
| amt-en-1001 | settled | um twelve hundred rupees | amount:1200 | start:withdraw money | missed_amount |
| amt-rom-hi-1001 | settled | paanch sau rupaye | amount:500 | answer | missed_amount |
| ctl-kn-1001 | settled | ಸ್ವಲ್ಪ ನಿಲ್ಲಿಸಿ | control:pause | no-start:CONTROL | missed_command |
| ctl-hi-1001 | settled | फिर से बोलिए | control:repeat | no-start:CONTROL | missed_command |
| ctl-en-1001 | settled | cancel that please | control:cancel | no-start:CONTROL | missed_command |
| ctl-kn-1002 | settled | ಮುಂದೆ ಹೋಗೋಣ | control:resume | no-start:CONTROL | missed_command |
