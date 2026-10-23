# M9 ASR output forms (text): m9_forms_baseline

**Text fixtures, not recognised audio.** Each reference utterance is written in the forms an ASR system produces; each form goes through the production routing and is scored against the reference's label. This measures the language layer's robustness to ASR output.

## By kind

| | n | correct | critical | miss | unscored |
|---|---|---|---|---|---|
| clipped | 6 | 2 | 2 | 0 | 2 |
| currency-symbol | 1 | 1 | 0 | 0 | 0 |
| digit-and-scale | 4 | 4 | 0 | 0 | 0 |
| digit-by-digit-account | 1 | 1 | 0 | 0 | 0 |
| digits | 7 | 7 | 0 | 0 | 0 |
| filler | 8 | 4 | 0 | 2 | 2 |
| latin | 16 | 13 | 0 | 1 | 2 |
| lowercase | 1 | 1 | 0 | 0 | 0 |
| misheard | 1 | 1 | 0 | 0 | 0 |
| native-digits | 2 | 2 | 0 | 0 | 0 |
| number-words | 1 | 0 | 0 | 1 | 0 |
| punctuated | 3 | 3 | 0 | 0 | 0 |
| reference | 40 | 29 | 4 | 2 | 5 |
| repetition | 1 | 1 | 0 | 0 | 0 |
| romanised | 2 | 2 | 0 | 0 | 0 |
| spelling-variant | 7 | 7 | 0 | 0 | 0 |
| split-word | 1 | 1 | 0 | 0 | 0 |
| unpunctuated | 1 | 0 | 0 | 0 | 1 |

## By language group

| | n | correct | critical | miss | unscored |
|---|---|---|---|---|---|
| en | 18 | 15 | 0 | 1 | 2 |
| hi | 20 | 14 | 2 | 1 | 3 |
| hi-en | 22 | 19 | 0 | 1 | 2 |
| kn | 20 | 13 | 3 | 1 | 3 |
| kn-en | 23 | 18 | 1 | 2 | 2 |

## By category

| | n | correct | critical | miss | unscored |
|---|---|---|---|---|---|
| ambiguous_request | 10 | 4 | 6 | 0 | 0 |
| amount | 22 | 21 | 0 | 1 | 0 |
| control | 12 | 9 | 0 | 3 | 0 |
| knowledge_question | 12 | 0 | 0 | 0 | 12 |
| refusal | 3 | 3 | 0 | 0 | 0 |
| service_request | 44 | 42 | 0 | 2 | 0 |

## Same outcome as the reference form

57 forms agree with their reference form; 4 do not.

| Item | form | reference outcome | form outcome |
|---|---|---|---|
| ctl-kn-901 | filler | correct | missed_command |
| ctl-hi-901 | filler | correct | missed_command |
| amt-en-901 | number-words | correct | missed_amount |
| ctl-hi-en-901 | latin | missed_command | correct |

## Every form that was not correct

| Item | kind | text | outcome |
|---|---|---|---|
| svc-kn-901 | clipped | ನನಗೆ ಐದು ಸಾವಿರ ರೂಪಾಯಿ | guessed_service (critical) |
| kq-kn-901 | reference | ಸಾಲ ಪಡೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು | llm_gated (unscored) |
| kq-kn-901 | clipped | ಸಾಲ ಪಡೆಯಲು ಯಾವ | llm_gated (unscored) |
| kq-kn-901 | filler | ಅದು ಸಾಲ ಪಡೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು | llm_gated (unscored) |
| ctl-kn-901 | filler | ಹಾಂ ಮತ್ತೆ ಹೇಳಿ | missed_command (miss) |
| amb-kn-901 | reference | ಸ್ವಲ್ಪ ಹಣದ ವಿಷಯ ಮಾತಾಡಬೇಕು | guessed_service (critical) |
| amb-kn-902 | reference | ಹಣ | guessed_service (critical) |
| svc-hi-901 | clipped | मुझे तीन हज़ार रुपये | guessed_service (critical) |
| kq-hi-901 | reference | बचत खाते में ब्याज कैसे मिलता है | llm_gated (unscored) |
| kq-hi-901 | filler | जी बचत खाते में ब्याज कैसे मिलता है | llm_gated (unscored) |
| kq-hi-901 | clipped | बचत खाते में ब्याज कैसे | llm_gated (unscored) |
| ctl-hi-901 | filler | जी दोबारा बताइए | missed_command (miss) |
| amb-hi-901 | reference | मुझे वो पैसे | guessed_service (critical) |
| kq-en-901 | reference | What documents do I need for a loan? | llm_gated (unscored) |
| kq-en-901 | unpunctuated | what documents do i need for a loan | llm_gated (unscored) |
| amt-en-901 | number-words | deposit three thousand into account number 778899 | missed_amount (miss) |
| svc-kn-en-904 | reference | ಎಟಿಎಂ ಕೆಲಸ ಮಾಡ್ತಿಲ್ಲ ಕ್ಯಾಶ್ ವಿತ್‌ಡ್ರಾ ಮಾಡಬೇಕು | abstained (miss) |
| svc-kn-en-904 | latin | ATM ಕೆಲಸ ಮಾಡ್ತಿಲ್ಲ cash withdraw ಮಾಡಬೇಕು | abstained (miss) |
| kq-kn-en-901 | reference | ಪಾಸ್‌ಬುಕ್ ಅಪ್ಡೇಟ್ ಹೇಗೆ ಮಾಡುವುದು | llm_gated (unscored) |
| kq-kn-en-901 | latin | passbook update ಹೇಗೆ ಮಾಡುವುದು | llm_gated (unscored) |
| amb-kn-en-901 | reference | ಅಕೌಂಟ್ ವಿಷಯ ಒಂದಿದೆ | guessed_service (critical) |
| kq-hi-en-901 | reference | लोन के लिए कौन कौन से डॉक्यूमेंट लगते हैं | llm_gated (unscored) |
| kq-hi-en-901 | latin | loan के लिए कौन कौन से documents लगते हैं | llm_gated (unscored) |
| ctl-hi-en-901 | reference | रिपीट कीजिए | missed_command (miss) |
