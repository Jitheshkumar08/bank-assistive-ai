# M9 ASR evaluation on real speech: m9_asr_baseline

Production recogniser on the IndicVoices clips on disk. Scored with the Phase 3.2B-7 normalisation, unchanged (number words vs digits and native vs Latin script count as errors).

**Banking clips are from IndicVoices' train split, which IndicConformer was very likely trained on: those numbers are optimistic. General clips are from the validation split. There is no English audio and no Latin-script code-switching audio, so those categories are not measured here.**

| Set / split / category | clips | min | WER % | CER % | exact | loanwords (recall %) | banking terms (recall %) | amount vs gold: correct / wrong / lost / invented | amount vs reference (ASR effect) | intent: unchanged / wrong service / lost / invented / other | errors | fallbacks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| banking / dev / kn | 12 | 1.4 | 21.0 | 5.7 | 2 | 0 (–) | 9 (100.0) | 6/7 · 0 · 1 · 0 | correct 6 | 11 / 0 / 0 / 1 / 0 | 0 | 0 |
| banking / dev / kn-en | 38 | 6.5 | 16.0 | 4.0 | 6 | 82 (89.0) | 13 (100.0) | 14/15 · 1 · 0 · 1 | correct 15, wrong 1 | 35 / 3 / 0 / 0 / 0 | 0 | 0 |
| banking / dev / hi | 21 | 3.1 | 11.3 | 2.9 | 4 | 0 (–) | 10 (100.0) | 7/9 · 0 · 2 · 0 | correct 7 | 18 / 1 / 2 / 0 / 0 | 0 | 0 |
| banking / dev / hi-en | 29 | 5.5 | 13.5 | 3.6 | 5 | 68 (91.2) | 35 (100.0) | 9/11 · 0 · 2 · 0 | correct 9 | 27 / 0 / 2 / 0 / 0 | 0 | 0 |
| banking / dev / kn (all) | 50 | 7.9 | 16.9 | 4.3 | 8 | 82 (89.0) | 22 (100.0) | 20/22 · 1 · 1 · 1 | correct 21, wrong 1 | 46 / 3 / 0 / 1 / 0 | 0 | 0 |
| banking / dev / hi (all) | 50 | 8.6 | 12.7 | 3.4 | 9 | 68 (91.2) | 45 (100.0) | 16/20 · 0 · 4 · 0 | correct 16 | 45 / 1 / 4 / 0 / 0 | 0 | 0 |
| banking / held-out / kn | 15 | 1.9 | 15.4 | 3.2 | 3 | 0 (–) | 7 (85.7) | 3/3 · 0 · 0 · 0 | correct 3 | 15 / 0 / 0 / 0 / 0 | 0 | 0 |
| banking / held-out / kn-en | 35 | 6.0 | 18.1 | 3.9 | 3 | 64 (81.2) | 15 (100.0) | 10/13 · 0 · 3 · 0 | correct 10, lost 2 | 29 / 2 / 0 / 4 / 0 | 0 | 0 |
| banking / held-out / hi | 15 | 2.2 | 12.1 | 4.0 | 4 | 0 (–) | 7 (100.0) | 5/6 · 0 · 1 · 0 | correct 5 | 13 / 1 / 0 / 1 / 0 | 0 | 0 |
| banking / held-out / hi-en | 35 | 5.2 | 10.9 | 2.8 | 9 | 61 (90.2) | 35 (100.0) | 16/17 · 0 · 1 · 0 | correct 16 | 33 / 0 / 2 / 0 / 0 | 0 | 0 |
| banking / held-out / kn (all) | 50 | 8.0 | 17.4 | 3.8 | 6 | 64 (81.2) | 22 (95.5) | 13/16 · 0 · 3 · 0 | correct 13, lost 2 | 44 / 2 / 0 / 4 / 0 | 0 | 0 |
| banking / held-out / hi (all) | 50 | 7.4 | 11.2 | 3.1 | 13 | 61 (90.2) | 42 (100.0) | 21/23 · 0 · 2 · 0 | correct 21 | 46 / 1 / 2 / 1 / 0 | 0 | 0 |
| general / held-out / kn | 181 | 23.5 | 41.4 | 13.1 | 12 | 0 (–) | 6 (83.3) | 5/7 · 0 · 2 · 0 | correct 5, lost 2 | 157 / 2 / 9 / 10 / 3 | 0 | 0 |
| general / held-out / kn-en | 19 | 3.7 | 24.5 | 7.4 | 0 | 27 (77.8) | 7 (100.0) | 2/3 · 0 · 1 · 0 | correct 2, lost 1 | 15 / 1 / 1 / 1 / 1 | 0 | 0 |
| general / held-out / hi | 163 | 21.1 | 17.6 | 7.0 | 24 | 0 (–) | 22 (90.9) | 4/6 · 2 · 0 · 0 | correct 4, wrong 2 | 130 / 4 / 6 / 5 / 18 | 0 | 0 |
| general / held-out / hi-en | 37 | 6.8 | 14.5 | 5.7 | 5 | 72 (76.4) | 20 (100.0) | 3/3 · 0 · 0 · 0 | correct 3 | 29 / 0 / 2 / 1 / 5 | 0 | 0 |
| general / held-out / kn (all) | 200 | 27.1 | 39.3 | 12.4 | 12 | 27 (77.8) | 13 (92.3) | 7/10 · 0 · 3 · 0 | correct 7, lost 3 | 172 / 3 / 10 / 11 / 4 | 0 | 0 |
| general / held-out / hi (all) | 200 | 27.9 | 16.8 | 6.7 | 29 | 72 (76.4) | 42 (95.2) | 7/9 · 2 · 0 · 0 | correct 7, wrong 2 | 159 / 4 / 8 / 6 / 23 | 0 | 0 |

## Routing against the annotated intent (banking clips)

Annotations are first-pass and not human-verified. In scope: the annotated intent is one of the assistant's services (balance, deposit, withdrawal); the right decision is to start it. Out of scope (transfer, payment, other): the right decision is to start nothing.

| Set / split / category | in scope | correct on reference | correct on ASR | out of scope | started on reference | started on ASR |
|---|---|---|---|---|---|---|
| banking / dev / kn | 0 | 0 | 0 | 12 | 10 | 11 |
| banking / dev / kn-en | 6 | 4 | 3 | 32 | 28 | 28 |
| banking / dev / hi | 1 | 0 | 0 | 20 | 6 | 4 |
| banking / dev / hi-en | 5 | 3 | 2 | 24 | 4 | 4 |
| banking / dev / kn (all) | 6 | 4 | 3 | 44 | 38 | 39 |
| banking / dev / hi (all) | 6 | 3 | 2 | 44 | 10 | 8 |
| banking / held-out / kn | 1 | 0 | 0 | 14 | 10 | 10 |
| banking / held-out / kn-en | 7 | 0 | 1 | 28 | 20 | 23 |
| banking / held-out / hi | 1 | 0 | 0 | 14 | 3 | 4 |
| banking / held-out / hi-en | 7 | 2 | 2 | 28 | 8 | 6 |
| banking / held-out / kn (all) | 8 | 0 | 1 | 42 | 30 | 33 |
| banking / held-out / hi (all) | 8 | 2 | 2 | 42 | 11 | 10 |

## Clips where ASR changed the amount or the routing decision

| Clip | split | category | effect | reference | hypothesis |
|---|---|---|---|---|---|
| ivb_kn_002 | dev | kn | routing service_invented: llm_gate -> start/withdraw money | ಮೊಬಿಕ್ವಿಕ್ ಆ್ಯಪಿನಲ್ಲಿ ಮಾರುತಿ ಕಾಮತ್ ಅವರಿಗೆ ತಿಂಗಳಿಗೊಮ್ಮೆ ಅಟೋಮೆಟಿಕ್ ಆಗಿ ಕಳಿಸ್ತಿರೋ ಒಂದು ಸಾವಿರ  | ಮೊಬಿಕ್ವಿಕ್ ಆ್ಯಪ್ನಲ್ಲಿ ಮಾರುತಿ ಕಾಮತ್ ಅವರಿಗೆ ತಿಂಗಳಿಗೊಮ್ಮೆ ಆಟೋಮೆಟಿಕ್ಕಾಗಿ ಕಳಿಸ್ತಿರೋ ಒಂದು ಸಾವಿರ  |
| ivb_kn_009 | dev | kn-en | routing wrong_service: start/withdraw money -> start/check account balance | ಟ್ಯಾಪ್ ಆ್ಯಂಡ್ ಪೇ ಮೆಥೆಡಲ್ಲಿ ನನ್ನ ಡಿಫಾಲ್ಟ್ ಕಾರ್ಡನ್ನು ಮೇಘಾಲಯ ರೂರಲ್ ಬ್ಯಾಂಕ್ ಡೆಬಿಟ್ ಕಾರ್ಡಿಂದ ಯು | ಟ್ಯಾಪ್ ಆ್ಯಂಡ್ ಪೇಮೆಥೆಡ್ಲ್ಲಿ ನನ್ನ ಡೀಫಾಲ್ಟ್ ಕಾರ್ಡನ್ನು ಮೇಘಾಲಯ ರೂರಲ್ ಬ್ಯಾಂಕ್ ಡೆಬಿಟ್ ಕಾರ್ಡ್ ಇಿಂದ |
| ivb_kn_010 | dev | kn-en | ASR changed the amount (wrong): 200 -> 700 | ಯುನಿಶೆಫ್ಗೆ ಅನಾಮಧೇಯವಾಗಿ ಎರಡ್ನೂರು ರೂಪಾಯಿಯನ್ನ ಟ್ರಾನ್ಸ್ಫರ್ ಮಾಡೋಕ್ಕಾಗತ್ತಾ | ಯುನಿಷೆಪ್ಗೆ ಅನಾಮಧೇಯವಾಗಿ ಏಳುನೂರು ರೂಪಾಯನ ಟ್ರಾನ್ಸ್ಫರ್ ಮಾಡೋಕ್ಕಾಗತ್ತಾ |
| ivb_kn_033 | dev | kn-en | routing wrong_service: start/check account balance -> start/withdraw money | ನನ್ನ ಧನಲಕ್ಷ್ಮಿ ಬ್ಯಾಂಕ್ ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ನ ಟೊಕನೈಸ್ಡ್ ಪಾವತಿಗಳಿಗೆ ರಿಜಿಸ್ಟರ್ ಮಾಡಿಸೋಕ್ಕೆ ಕ್ಯೂ ಆರ್ | ನನ್ನ ಧನಲಕ್ಷ್ಮೀ ಬ್ಯಾಂಕ್ ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ ಟೋಕನೈಸ್ಡ್ ಪಾವತಿಗಳಿಗೆ ರಿಜಿಸ್ಟರ್ ಮಾಡಸೋಕ್ಕೆ ಕ್ಯೂ ಆರ್ ಕೋ |
| ivb_kn_042 | dev | kn-en | routing wrong_service: start/check account balance -> start/deposit money | ನನ್ನ ಕೇರಳ ಗ್ರಾಮೀಣ್ ಬ್ಯಾಂಕ್ ಖಾತೇಲಿ ಮೂರು ಸಾವಿರ ರೂಪಾಯಿ ಇರುತ್ತಾ | ನನ್ನ ಕೇರಳ ಗ್ರಾಮೀಣ್ ಬ್ಯಾಂಕ್ ಖಾತೆಯಲ್ಲಿ ಮೂರು ಸಾವಿರ ರೂಪಾಯಿ ಇರತ್ತಾ |
| ivb_kn_052 | held-out | kn-en | routing service_invented: llm_gate -> start/withdraw money | ಕಳೆದ ವಾರ ಏಳು ಸಾವಿರ ರೂಪಾಯಿಯ ರೀಫಂಡ್ ಪ್ರೋಸೆಸ್ ಆಗಿದೆಯಾ ಅಂತ ಝೊಮ್ಯಾಟೊ ಟ್ರಾನ್ಸಾಕ್ಷನ್ಲಿ ಚೆಕ್ ಮಾಡೋಕ | ಕಳೆದ ವಾರ ಏಳು ಸಾವಿರ ರೂಪಾಯಿಯ ರೀಫಂಡ್ ಪ್ರಸ್ ಆಗಿದೆಯಾ ಅಂತಝೊಮ್ಯಾಟೋ ಟ್ರಾನ್ಸಾಕ್ಷ ಚೆಕ್ ಮಾಡಕ್ಕಾಗತ್ತಾ |
| ivb_kn_055 | held-out | kn-en | routing service_invented: llm_gate -> start/withdraw money | ಪೇ ಝ್ಯಾಪ್ ಆ್ಯಪ್ನಲ್ಲಿ ನನ್ನ ಡಿಫಾಲ್ಟ್ ಬ್ಯಾಂಕ್ ಅಕೌಂಟ್ನ ಬದಲಾಯಿಸೋಕ್ಕಾಗುತ್ತಾ | ಪೇಜ್ಯಾಪ್ ಆ್ಯಪ್ನಲ್ಲಿ ನನ್ನ ಡೀಫಾಲ್ಟ್ ಬ್ಯಾಂಕ್ ಅಕೌಂಟನ್ನ ಬದಲಾಯ್ಸೋಕ್ಕಾಗತ್ತಾ |
| ivb_kn_060 | held-out | kn-en | ASR changed the amount (lost): 600 -> None | ನನ್ನ ಸಿಟ್ರಸ್ ವ್ಯಾಲೆಟ್ಗೆ ಆರುನೂರು ರೂಪಾಯಿ ಟ್ರಾನ್ಸ್ಫರ್ ಮಾಡು ಪ್ಲೀಸ್ | ನನ್ನ ಸಿಂಟ್ರಸ್ ವ್ಯಾಲೆಟ್ಗೆ ಆರ್ನೂರು ರೂಪಾಯಿ ಟ್ರಾನ್ಸ್ಫರ್ ಮಾಡು ಪ್ಲೀಸ್ |
| ivb_kn_067 | held-out | kn-en | routing wrong_service: start/withdraw money -> start/check account balance | ಪೇಯೂ ಮನೀಲ್ಲಿ ವಾಟರ್ ಬಿಲ್ ಪೇಮೆಂಟ್ಸ್ದು ನೋಟಿಫಿಕೇಷನ್ಸ್ ಆನ್ ಮಾಡು | ಪೇಯು ಮನಿಲಿ ವಾಟರ್ ಬಿಲ್ ಪೇಮೆಂಟ್ಸ್ದು ನೋಟಿಫಿಕೇಷನ್ಸ್ ಆನ್ ಮಾಡು |
| ivb_kn_075 | held-out | kn-en | routing wrong_service: start/withdraw money -> start/check account balance | ನನ್ ಸಿ ಎಸ್ ಬಿ ಬ್ಯಾಂಕ್ ಖಾತೆಯಲ್ಲಿ ಒಂಬತ್ತು ಸಾವಿರ ರೂಪಾಯಿ ಇರುತ್ತಾ | ನನ್ನ ಸಿ ಎಸ್ ಬಿ ಬ್ಯಾಂಕ್ ಖಾತೆಯಲ್ಲಿ ಒಂಬತ್ತು ಸಾವಿರ ರೂಪಾಯಿ ಇರತ್ತಾ |
| ivb_kn_077 | held-out | kn-en | ASR changed the amount (lost): 60000 -> None; routing service_invented: llm_gate -> start/withdraw money | ನನ್ನ ಅರುಣಾಚಲ ಪ್ರದೇಶ್ ರೂರಲ್ ಬ್ಯಾಂಕ್ ಅಕೌಂಟ್ನಿಂದ ನನ್ನ ಐ ಸಿ ಐ ಸಿ ಐ ಪ್ಯಾಕೆಟ್ಸ್ ವ್ಯಾಲೆಟ್ಗೆ ಅರವತ್ | ನನ್ನ ಅರುಣಾಚಲ ಪ್ರದೇಶ್ ರೂರಲ್ ಬ್ಯಾಂಕ್ ಅಕೌಂಟ್ನಿಂದ ನನ್ನ ಐ ಸಿ ಐ ಸಿ ಐ ಪ್ಯಾಕೆಟ್ಸ್ ವ್ಯಾಲೆಟ್ಗೆ ಅರರುವ |
| ivb_kn_097 | held-out | kn-en | routing service_invented: llm_gate -> start/apply for loan | ನಾನು ನೈನಿತಾಲ್ ಬ್ಯಾಂಕ್ನಲ್ಲಿರೋ ನನ್ನ ಭದ್ರತಾ ಸಾಲದ ಮರುಪಾವತಿಯನ್ನು ಪೇ ಜ್ಯಾಪ್ ಮೂಲಕ ಮಾಡಬಹುದಾ | ನಾನು ನೈನಿತಾಲ್ ಬ್ಯಾಂಕ್ನಲ್ಲಿರೋ ನನ್ನ ಭದ್ರತಾ ಸಾಲದ ಮರುಪಾವತಿಯನ್ನು ಪೇಜ್ಯಾಪ್ ಮೂಲಕ ಮಾಡಬೌದಾ |
| ivb_hi_003 | dev | hi | routing wrong_service: start/open new account -> start/check account balance | लाइमरोड को मेरे खाते से लिंक करने के लिए ओ टी पी फिर से भेजें | लाइम रोड को मेरे खाते से लिंक करने के लिए ओ टी पी फिर से भेजें |
| ivb_hi_011 | dev | hi-en | routing service_lost: start/deposit money -> no-start/KNOWLEDGE_QUESTION | मुझे मेरा मध्यप्रदेश ग्रामीण बैंक खाता शेष और लेन देन इतिहास दिखाएँ | मुझे मेरा मध्य प्रदेश ग्रामीण बैंक खाता सेस और लेनदेन इतिहास दिखाएँ |
| ivb_hi_016 | dev | hi-en | routing service_lost: start/check account balance -> no-start/AMBIGUOUS_SERVICE | मेरे केरला ग्रामीण बैंक खाते में कितना बैलेंस है | मेरे केरल ग्रामीण बैंक खाते में कितना बैलेंस है |
| ivb_hi_018 | dev | hi | routing service_lost: start/open new account -> no-start/KNOWLEDGE_QUESTION | पिछले चौबीस घंटे के लिए मेरा लेनदेन इतिहास खोलें और संपर्क आर्यमान कुमावत को म्यूट करें | अगले चौबीस घंटे के लिए मेरा लेन देन इतिहास खोलें और संपर्क आर्मान कुमावत को म्यूट करें |
| ivb_hi_039 | dev | hi | routing service_lost: start/apply for loan -> no-start/KNOWLEDGE_QUESTION | कृपया मुझे चौबीस घंटे केवल टी वी विल की लेन देन रसीद दिखाएँ | कृपया मुझे चौबीस घंटे केवल टी वी बिल की लेन देन रसीद दिखाएँ |
| ivb_hi_075 | held-out | hi-en | routing service_lost: start/check account balance -> no-start/KNOWLEDGE_QUESTION | जब मैं ऑनलाइन सॉपिंग ऐप्स पर आठ सौ रुपये तक पहुँच जाऊँ तो कृपया मुझे सचेत करें | जब मैं ऑनलाइन शॉपिंग ऐप्स पर आठ सौ रुपये तक पहुच जाऊँ तो कृपया मुझे सचेत करें |
| ivb_hi_076 | held-out | hi-en | routing service_lost: start/deposit money -> no-start/KNOWLEDGE_QUESTION | कृपया छह हज़ार रुपये का भुगतान करें दक्षिण ग्रामीण बिहार ग्रामीण बैंक खाते छः चार सात आठ द | कृपया छः हजार रुपये का भुगतान करें दक्षि ग्रामी बिहार ग्रामीण बैंक खाते छ चार सात आठ दो एक |
| ivb_hi_079 | held-out | hi | routing wrong_service: start/withdraw money -> start/deposit money | दो सौ रुपये मदर हेल्प ऐज़ को दान करें | दो सौ रुपये मदर हेल्प एज को दान करें |
| ivb_hi_090 | held-out | hi | routing service_invented: no-start/KNOWLEDGE_QUESTION -> start/deposit money | मेरा ओला मनी क्यूआर कोड मुरली जसावत से वॉट्सएप पर शेयर करें | मेरा ओला मनी क्यू आर कोड मुरली जसावद से वॉट्सएप पर शेयर करें |
| iv_kn_009 | held-out | kn | routing service_lost: start/withdraw money -> llm_gate | ನನ್ನ ಹವಾಮಾನ ಆಧರಿತ ಬೆಳೆ ವಿಮಾ ಯೋಜನೆ ಅಡಿಯಲ್ಲಿ ಬೆಳೆ ವಿಮಾ ಪಾಲಿಸಿಯ ವಿವರಗಳನ್ನು ನೀವು ನನಗೆ ಒದಗಿಸಬಹು | ನನ್ನ ಹವಾಮಾನ ಆಧಾರತ ಬೆಳೆ ವಿಮಾ ಯೋಜನೆ ಅಡಿಯಲ್ಲಿ ಬೆಳೆ ವಿಮಾ ಪಾಲಿಸಿಯ ವಿವರಗಳನ್ನು ನೀವು ನನಗೆ ಒದಗಿಸಬಹು |
| iv_kn_029 | held-out | kn-en | routing service_invented: llm_gate -> start/withdraw money | ಭಾರತೀಯ ವಿಜ್ಞಾನ ಸಂಸ್ಥೆ ಬೆಂಗಳೂರು ಎ ಐ ಸಿ ಟಿ ಇ ಅಪ್ರೂವ್ಡ್ ಸಂಸ್ಥೇನ ಅಂತ ಚೆಕ್ ಮಾಡೋಕ್ಕಾಗುತ್ತಾ | ಭಾರತೀಯ ವಿಜ್ಞಾನ ಸಂಸ್ಥೆ ಬೆಂಗಳೂರು ಎ ಐ ಸಿ ಟಿ ಇ ಅಪ್ರೂವ್ಡ್ ಸಂಸ್ಥೇನಾ ಅಂತ ಚೆಕ್ ಮಾಡೋಕ್ಕಾಗತ್ತಾ |
| iv_kn_033 | held-out | kn-en | routing wrong_service: start/check account balance -> start/deposit money | ನನಗೆ ಕಳೆದ ಹೇಳು ತಿಂಗಳ ಬ್ರಾಡ್ಬ್ಯಾಂಡ್ ಬಿಲ್ ರೀಡಿಂಗ್ ತೋರಿಸು | ನನಗೆ ಕಳೆದ ಏಳು ತಿಂಗಳ ಬ್ರಾಡ್ಬ್ಯಾಂಡ್ ಬಿಲ್ ರೀಡಿಂಗ್ ತೋರಿಸು |
| iv_kn_038 | held-out | kn | routing service_invented: llm_gate -> start/withdraw money | ವಿದ್ಯುತ್ ಯಂತ್ರೋಪಕರಣ ಕ್ಯಾಟಗರೀಲಿ ತುಂಬ ಮಾರಾಟ ಆಗೋ ರೆಕಮೆಂಡೇಷನ್ಸ್ ಯಾವುವು | ವಿದ್ಯುತ್ ಯಂತ್ರೋಪಕರಣ ಕಟಗರಿಲಿ ತುಂಬ ಮಾರಾಟ ಹಾಗೋ ರೆಕಮೆಂಡೇಷನ್ಸ್ ಯಾವವು |
| iv_kn_047 | held-out | kn | routing service_lost: start/withdraw money -> llm_gate | ನೀರು ಬೇಕಾ ಬೇಕಾ ಅಂದೆನೋ ಹೊತ್ಗೆಗೆ ಮತ್ತೆ ಏನ್ಮಾಡೋಕೆ ಆಗುತ್ತೆ ಹೇಳು ಅಲ್ಲೇ ಮತ್ತೋಗಿ ಬಾಳ್ವೆಗೆ ಕೊಡ ಕಟ್ | ನೀರು ಬೇಕ ಬೇಕಂದತ್ತ ಮತ್ತ ಏನು ಮಾಡಕ್ಕಾಗುತ್ತೆ ಹೇಳಿ ಅಲ್ಲೇ ಮತ್ತೋಗಿ ಬ ಕೊಡ ಕಟ್ಟು ಬಾಬ ನೀರ ತಗೊಂಡು ಬಂದ |
| iv_kn_054 | held-out | kn-en | routing changed_non_service: llm_gate -> no-start/BANKING_INTENT | ಆನ್ಲೈನಲ್ಲಿ ತಗೊಂಡ್ರು ಏನು ಇಲ್ಲ ಅದಕ್ಕೋಸ್ಕರ ನಾನು ಇದು ತಗೊಂಡಿದ್ದೆ ಫೋನ್ ಇವಾಗ ಪರವಾಗಿಲ್ಲ ಎಲ್ಲ ನನಗೆ  | ಆನ್ಲೈನಲ್ಲಿ ತಕೊಂಡ್ರೂ ಏನುೂ ಇಲ್ಲ ಅದಕ್ಕೋಸ್ಕರ ನಾನು ಇದು ತಗೊಂಡಿದ್ದೆ ಫೋನು ಇವಾಗ ಪರವಾಗಿಲ್ಲ ಎಲ್ಲ ನಮಗೆ |
| iv_kn_061 | held-out | kn | routing service_invented: llm_gate -> start/withdraw money | ಜಾಸ್ತಿ ಸಿಟಿಯವ್ರು ಹೇಗೆ ಮಾಡ್ತಾರೋ ಹಾಗೆ ಕಲೀತಿದ್ವಿ ನಾವು ಸಿಟಿ ಬಂದು ನಾವು ಇಂಗ್ಲೀಷ್ ಮೀಡಿಯಮಲ್ಲಿ ಎಜುಕ | ಜಾಸ್ತಿ ಸಿಟಿ ಅವರುೇಗೆ ಮಾಡ್ತಾರೋ ಆ ಗಲೀತಿದ್ವಿ ನಾವು ಸಿಟಿಿಗೆ ಬಂದು ನಾವು ಇಂಗ್ಲೀಷ್ ಮೀಡಿಯಮಲ್ಲಿ ಎಜುಕೇಷ |
| iv_kn_065 | held-out | kn | routing service_invented: llm_gate -> start/withdraw money | ಎಲ್ಲ ಆಗೋಗಿತ್ತು ಸೊ ಇನ್ನು ಏನು ತಾಳಿ ಕಟ್ಟೋ ಸಂದರ್ಭದಲ್ಲಿ ಅವರು ಪೋಲೀಸರು ಬಂದು ಅವ್ರನ್ನ ಕರ್ಕೊಂಡು | ಎಲ್ಲ ಆಗೋಗಿತ್ತು ಸೋ ಇನ್ನೂ ಏನೋ ತಾಳ ಕಟ್ಟೋ ಸಂದರ್ಭದಲ್ಲಿ ಅವರು ಪೊಲೀಸರು ಬಂದು ಅವರನ್ನ ಕರ್ಕೊಂಡು |
| iv_kn_068 | held-out | kn | ASR changed the amount (lost): 829 -> None; routing service_invented: no-start/KNOWLEDGE_QUESTION -> start/withdraw money | ಎಂಟುನೂರ ಇಪ್ಪತ್ತೊಂಬತ್ತು | ಎಂಟನೂರ ಇಪ್ಪತ್ತೊಂಬತ್ತು |
| iv_kn_076 | held-out | kn | routing changed_non_service: llm_gate -> no-start/BANKING_INTENT | ಪಂಚಾಯಿತಿಯಿಂದ ಬಿಟ್ಟಿರುವಂತಹ ಹಸಿಕಸ ಒಣಕಸದ ವ್ಯಾನು ಕರೆಕ್ಟಾಗಿ ಪ್ರತಿ ತಿಂಗಳಿಗೊಮ್ಮೆ ಪ್ರತಿ ವಾರಕ್ಕೊಮ್ಮ | ಪಂಚಾಯತಿಂದ ಬಿಟ್ಟಿರುವಂತಹ ಹಸ್ತಿಿಕಾಸ ಹಣಕಾಸದ ವ್ಯಾನು ಕರಕ್ಟಾಗಿ ಪ್ರತಿ ತಿಂಗಗಳಿಗೊಮ್ಮೆ ಪ್ರತಿ ವಾರಕ್ಕೊಮ |
| iv_kn_091 | held-out | kn | routing service_lost: start/withdraw money -> llm_gate | ಒಂದು ವರ್ಷನ ಆಗಿನ ಬಾದ ಆವಾಗ ಮತ್ತೆ ಬರ್ತ್ಡೇ ಸೆಲೆಬ್ರೆಟ್ ಅಂತ ಮಾಡ್ತಾರೆ ಇಷ್ಟು ಅಂತ ಇರ್ತನ ನೋಡಿ ಸಣ್ಣ ಹ | ಒಂದು ವರ್ಷನಗನ ಬ ಆವಾಗ ಮತ್ತ ಬರ್ಡೇ ಸೆಲೆಬ್ರೇಟಂದು ಮಾಡ್ತಾರೆ ಇಷ್ಟಂತ ಇರ್ತದು ನೋಡರಿ ಸಣ್ಣ ಹುಡುಗರುಂದ್ರೆ |
| iv_kn_114 | held-out | kn | routing service_invented: no-start/BANKING_INTENT -> start/withdraw money | ಈ ರೀತಿ ಕೊಟ್ಟಾಗ ಮಕ್ಳುಗಳ್ಗೆ ಕಾಲೇಜು ಸ್ಕೂಲುಗಳ್ಗೆ ಕಳ್ಸೋಕೆ ಪೋಷಕರು ಹೆದರುತ್ತಾರೆ ಹಳ್ಳಿ ಹಳ್ಳಿ ಕಡೆಯೆಲ | ಈ ರೀತಿ ಕೊಟ್ಟಾಗ ಮ ಮಕ್ಕಳುಗಳಿಗೆ ಕಾಲೇಜು ಸ್ಕೂಲ್ಗಳಿಗೆ ಕಳ್ಸೋಕ್ಕೆ ಪೋಷಕರು ಹೆದರುತಾರೆ ಹಳ್ಳಿ ಹಳ್ಳಿ ಕಡೆ |
| iv_kn_124 | held-out | kn | routing service_lost: start/withdraw money -> no-start/KNOWLEDGE_QUESTION | ಹೌದು ಹೌದು ಫೀಸ್ ಏನೂ ಕಟ್ಟಬೇಕಾ ಅದಕ್ಕೆ | ಹೌದು ಹೌದು ಫೀಸ್ ಏ ಕಟ್ಬೇಕಾ ಅದಕ್ಕೆ |
| iv_kn_125 | held-out | kn | routing service_lost: start/withdraw money -> no-start/KNOWLEDGE_QUESTION | ಕೈ ಕಾಲು ನೋವು ಕೈ ಕಾಲು ನೋವು ವಾಂತಿ | ಕೈಕ ನೋವು ಕೈಕ ನೋವು ವಾಟಿ |
| iv_kn_129 | held-out | kn | routing service_lost: start/withdraw money -> no-start/BANKING_INTENT | ದರ್ಶ್ನಕ್ಕೆ ಹೋಗೋಕ್ಕಿನ ಮುಂಚೆ ನಾವು ಹಿಂಗೆ ಒಂದು ಸ್ವಲ್ಪ ಫ್ರೆಶ್ಶಪ್ ಆಗಬೇಕಿತ್ತು ಯಾವುದಾದ್ರು ಅಲ್ಲೆ ಹತ | ದರ್ಶನಕ್ಕೆ ಹೋಗಕಿನೋ ಮುಂಚೆ ನಾವು ಹಗೆ ಒಂದು ಸ್ವಲ್ಪ ಫ್ರೆಶಪ್ ಆಗಬೇಕಿತ್ತು ಯಾದರೂ ಅಲ್ಲೇ ಹತ್ತಿರದಲ್ಲಿರೋಂ |
| iv_kn_131 | held-out | kn | routing service_invented: llm_gate -> start/withdraw money | ಹಾಂ ಪ್ಯಾಕೇಜ್ ಅಂದ್ರೆ ಅಲ್ಲಿ ನೀವು ಅಲ್ಲಿ ಏನಾದರು ಗಾಡಿ ಇರ್ತವಲ್ಲ ಅಣ್ಣ ಸಾಮಾನು ಇರ್ತೆ ನಮ್ಮ ಫ್ರೆಂಡಿನ  | ಪ್ಯಾಕೇಜ್ ಅಂದ್ರ ನೀವು ಅಲ್ಲಿನರೂ ಗ್ಯಳ ಇರ್ತಾವಲ್ಲಣ ಸಾಮನ್ತ್ತ ನಮ್ಮ ಫ್ರೆಂಡ್ಲ್ಲಿ ಕೇಳ್ರ ಕೇಳಿದರು ಹಗೆ ಲ |
| iv_kn_132 | held-out | kn | routing service_invented: llm_gate -> start/withdraw money | ಐತಿ ರೀ ಐತಿ ರೀ ಬರ್ತೀವಿ ರೀ ಅದು ಹೇಳ್ರಿ ಎಲ್ಲಿ ಬರಬೇಕು | ಆಯ್ತ್ರಿ ಆಯ್ತ್ರಿ ಬರ್ತೇವ್್ರ ಅದ ಹೇಳ್ರಿ ಎಲ್ ಬರ್ಬೇಕು |
| iv_kn_141 | held-out | kn | routing service_lost: start/withdraw money -> llm_gate | ಬಾಳೆಹಣ್ಣು ನೂರು ರೂಪಾಯಿ ಕೆ ಜಿ ಇದೆ ಸೇಬು ಹಣ್ಣು ಎರಡು ನೂರು ರೂಪಾಯಿ ಕೆ ಜಿ ಇದೆ ಕಿತ್ತಳೆ ಹಣ್ಣು ಅರವತ್ತ | ಬಾಳೆಹಣ್ಣ ನೂರು ರೂಪಾಯಿ ಕೆ ಜಿ ಇದೆ ಸೇಬಣ್ಣು ಎರಡುನೂರು ರೂಪಾಯಿ ಕೆ ಜಿ ಇದೆ ಕಿತ್ತಳೆ ಹಣ್ಣ ಅರವತ್ತು ರೂಪಾ |
| iv_kn_146 | held-out | kn | routing changed_non_service: llm_gate -> no-start/BANKING_INTENT | ಹಾಂ ಆರ್ ನಿಮ್ಮ ಮನೇಲಿ ಏನು ಮಾಡ್ತಾನೋ ಗೊತ್ತಿಲ್ಲ ಬಟ್ ಇಲ್ಲಿ ಸ್ಕೂಲಲ್ಲಿ ಮಾತ್ರ ಹಂಗಿದಾನೆ ನೋಡಿ ಮೇಡಮ್ ಯ | ನಿಮ್ಮ ಮನೇಲೇನು ಮಾಡ್ತಾನೆ ಗೊತ್ತಿಲ್ಲ ಬಟ್ ಇಲ್ಲಿ ಸ್ಕೂಲಲ್ಲಿ ಮಾತ್ರ ಹ್ಯಂಗಿದ್ದಾನೆ ನೋಡಿ ಮೇಡಮ್ ಯಾಕೇನೋ |
| iv_kn_148 | held-out | kn | ASR changed the amount (lost): 500 -> None | ಅದು ಒನ್ ಬುಟ್ಟಿ ಐನೂರು ಹಂಗ್ ಬೀಳುತ್ತಪ್ಪ | ಅದು ಒಂದುಬಿಟ್ಟಿ ಐನೂರುಂಗಗೆ ಬೀಳುತ್ತಪ್ಪ |
| iv_kn_158 | held-out | kn | routing wrong_service: start/apply for loan -> start/withdraw money | ಒಂದು ಅರ್ಧ ಕೆ ಜಿ ಉದ್ದಿನ ಬೇಳೆ | ಒಂದು ಅರ್ಧ ಕೆ ಜಿ ಉದ್ದಿನ ಬ್ಯಾಳಿ |
| iv_kn_168 | held-out | kn | routing wrong_service: start/apply for loan -> start/withdraw money | ಹಾಂ ಟ್ವೆಂಟಿ ಸಿಕ್ಸ್ ಕೆಜಿ ಸಿಗುತ್ತೆ ನಿಮಗ್ ಒಂದು ಪ್ಯಾಕೆಟ್ಟಲ್ಲಿ | ಹಾಂ ಟ್ವೆಂಟಿ ಸಿಕ್ಸ್ ಕೆ ಜ ಇರುತ್ತೆ ನಿಮಗೆ ಒಂದು ಪ್ಯಾಕೆಟಲ್ಲಿ |
| iv_kn_177 | held-out | kn | routing service_invented: llm_gate -> start/withdraw money | ಪರಿಸರ ಪರಿಸರ ನೀವು ಯಾವ ಪರಿಸರದಿಂದ ಹಿಡಿದು ಆ ಪರಿಸರದಲಿ ಊಟ ಮಾಡಿದ್ರೆ ಖುಷಿ ಬೇರೆ ಯಾಕಂದ್ರೆ | ಪರಿಸರ ಪರಿಸರ ಮೇಲೆ ಪರಿಸರಲ್ಲಿದ್ದ ಹಿಡಿದು ಆ ಪರಿಸರದಲ್ಲಿ ಊಟ ಮಾಡಿದ್ರರೆಷ್ಟು ಖುಷಿ ಬರ್ತೀನಿ ಯಾಕಂದ್ರ |
| iv_kn_178 | held-out | kn | routing changed_non_service: no-start/BANKING_INTENT -> llm_gate | ಟ್ಯಾಬ್ಲೆಟ್ಟೆಲ್ಲ ಕೊಟ್ಟಿದ್ದೆವಲ್ಲಾ ಸ್ವಲ್ಪ ಬಿಸಿ ನೀರು ಸ್ವಲ್ಪ ಹಾಲು ಗೀಲು ತೊಗೊಳ್ರಿ ತಲೆನೋವು ಜ್ವರ ಎಲ | ಟ್ಯಾಬ್್ಲೆಟ್ ಎಲ್ಲ ಕೊಟ್ಟಿದ್ವಲ್ಲ ಸ್ವಲ್ಪ ಬಿಸಿ ನೀರು ಸ್ವಲ್ಪ ಹಾವಿಗೆ ಎಲ್ಲ ತಗೊಳರಿಿ ತಲೆನೋವು ಜ್ವರ ಎಲ್ |
| iv_kn_182 | held-out | kn | routing service_lost: start/withdraw money -> no-start/BANKING_INTENT | ಈಗ ಮೊನ್ನೆ ಮಾಡಿದ್ದೆವಲ್ಲಾ ಅದ್ರಲ್ಲಿ ನೋಡ್ಕಂಡು ಇರ್ತೀರ ನೀವು ಚೆನ್ನಾಗಿತ್ತಾ ಅದು ಡೆಕೊರೇಶನ್ ಎಲ್ಲಾ | ಈಗ ಮೊನ್ನೆ ಮಾಡಿದ್ವಲ್ಲ ಅದರಲ್ಲಿ ನೋಡ್ಕೊಂಡಿರ್ತೀರಾ ನೀವು ಚೆನ್ನಾಗಿತ್ತುದು ಡೆಕೋರಷನ್ ಎಲ್ಲ |
| iv_kn_186 | held-out | kn-en | routing service_lost: start/withdraw money -> no-start/KNOWLEDGE_QUESTION | ಅ ರಾಹುಲವ್ರ ಪೇರೆಂಟ್ಸಾ | ರಾಹುಲ್ ಅವರ ಪೇರೆಂಟ್ಸ್ಸಾ |
| iv_kn_190 | held-out | kn | routing service_invented: llm_gate -> start/withdraw money | ಹ್ಞೂ ಹೌದಾ ಟೋಟಲ್ ಅಮೌಂಟ್ ಎಷ್ಟು ಆಗುತ್ತೆ ಅಂತ ಹೇಳಿ ಸರ್ ಒಂದ್ಸರಿ | ಹೌದಾ ಟೋಟಲ್ ಅಮೌಂಟ್ ಎಷ್ಟಾಗತ್ತೆ ಅಂತ ಹೇಳಿ ಸರ್ ಒಂದುಸರಿ |
| iv_kn_192 | held-out | kn-en | ASR changed the amount (lost): 200 -> None | ಯಾಕಂತಂದ್ರೆ ಇವು ಕಾ ಇದು ಲೀಗಲಿ ಅಂತಂದ್ರೆ ಒಂದು ಡೇ ವೇಟಾ ವೇಟ್ ಮಾಡಿರಿ ನೀವು ಒನ್ ಡೇ ವೇಟ್ ಮಾಡಿದ ಮೇಲೆ  | ಯಾಕಂತಂದ್ರೆ ಇವು ಕ ಇ ಲೀಗಲಿ ಅಂತಂದ್ರ ಒಂದು ಡೆವೇಟ್ ಆಗ ಬೇಟ್ ಮಾಡ್ರಿ ನೀವು ಒಂದು ಡವೇಟ್ ಮಾಡ್ರ್ರೆಮ ನಾಳೆ |
| iv_kn_193 | held-out | kn | routing service_lost: start/withdraw money -> no-start/BANKING_INTENT | ಹಾಂ ನಿಮ್ಮ ಹುಡುಗಿ ಈ ಸರಿ ಟೆಸ್ಟ್ ಅಲ್ಲಿ ಎಲ್ಲ ಮಾರ್ಕ್ಸ್ ಎಲ್ಲ ಕಡ್ಮೆ ತೆಗೆದಿದ್ದಾಳೆ | ನಿಮ್ಮ ಹಡುಗಿ ಈ ಸರಿ ಡೆಸ್ಟಲ್ಲೆಲ್ಲ ಮಾರ್ಕ್ಸ್ ಎಲ್ಲ ಕಡಿಮೆ ತೆಗೆದಾಳೆ |
| iv_kn_200 | held-out | kn | routing service_invented: no-start/BANKING_INTENT -> start/withdraw money | ಅಲ್ಲ ಈಗ ಸದ್ಯಕ್ಕೆ ಏನಾದರೂ ಟಾಬ್ಲೆಟ್ ಇದ್ದರೆ ಹೇಳಿ ಡಾಕ್ಟ್ರೇ | ಅದು ಈಗ ಸದ್ಯಕ್ಕೆೇನಾದರೂ ಟಾಬ್ಲೆಟ್ ಇದ್ದರೆ ಹೇಳಿ ಡಾಕ್ಟ್ರ |
| iv_hi_011 | held-out | hi | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/CONTROL | छः | छा |
| iv_hi_014 | held-out | hi | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/ACKNOWLEDGEMENT | इमामी रिफाइंड सनफ्लॉवर आयल जिसका मूल्य पाँच सो रुपये है जोड़ें | इमामी रिफाइड सनफ्लावर ऑयल जिसका मूल्य पाच सौ रुपय है जोड़ें |
| iv_hi_021 | held-out | hi | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/UNSUPPORTED | आज सुबह डिलीवर हुए बेकरी और कार आइटम्स खराब गुणवत्ता के थे | आज सुबह डिलीवर हुए बेकररी और कार आइटम्स खराब गुणवत्ता के थे |
| iv_hi_022 | held-out | hi | routing changed_non_service: no-start/CONTROL -> no-start/UNSUPPORTED | ग्रीन लाइन एम बी टी ए पर दूसरी सबसे लोकप्रिय सबवे लाइन है | ग्रीन लाइन एम बी टी ए पर दूसरी सबसे लोकप्रिय सबव लाइन है |
| iv_hi_030 | held-out | hi | routing service_lost: start/deposit money -> no-start/KNOWLEDGE_QUESTION | स्टेडियम ने दो हज़ार सत्रह फीफा अंडर सत्रह विश्व कप के फाइनल की मेज़बान की थी | स्टेडियम ने दो हज़ार सत्रह फ़ीफा अंडर सत्रह विश्वकप के फाइनल की मेज़बान की थी |
| iv_hi_033 | held-out | hi-en | routing service_lost: start/withdraw money -> no-start/KNOWLEDGE_QUESTION | जब मैं ऑनलाइन शॉपिंग ऐप पर सात हज़ार रुपये तक पहुँच जाऊँ तो कृपया मुझे सचेत करें | जब मैं ऑनलाइन शॉपिंग प पर सात हज़ार रुपये तक पहुच जाऊँ तो कृपया मुझे सचेत करें |
| iv_hi_043 | held-out | hi | routing service_lost: start/check account balance -> no-start/CONTROL | और इसलिए उनको बहुत आगे माना जाता था लेकिन अब | और इसल उनको बहुत आगे माना जाता था लेकिन अब |
| iv_hi_046 | held-out | hi | routing changed_non_service: no-start/BANKING_INTENT -> no-start/KNOWLEDGE_QUESTION | कि यहाँ पर भी बच्चे को पढ़ने के लिए खेलने के लिए बच्चों को भी या तो कोई पर्यटक लोग को घूमन | यहाँ प भी बच्चे को पढ़ने के लिए खेलने के लिए बच्चों को भी या तो कोई पटिकल को घूमने फिरने क |
| iv_hi_047 | held-out | hi | routing service_invented: no-start/KNOWLEDGE_QUESTION -> start/check account balance | कारवार करते हैं बर्तन धोते हैं मांझते हैं करते है तो एकरे बाद में नहा करके खाना बनाते है स | कार बार करते हैं बर्तन धोते हैं मचते हैं करते हैं तो एक बाद में नहा कर के खाना बनाते हैं स |
| iv_hi_048 | held-out | hi | routing service_lost: start/open new account -> no-start/ACKNOWLEDGEMENT | हम बेगूसराय ज़िला से बोलते हैं मतलब हम बारह प्रकार का मतलब हिन्दू धरम है और वह छठ पूजा छठ  | हम बेगूसराय ज़िला से बोलते हैं मतलब हम ब बारे प्रकार के मतलब हिदू धर्म है और छठ पूजा छठ पू |
| iv_hi_052 | held-out | hi | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/ACKNOWLEDGEMENT | अच्छे से देख भाल करिए अस सेवा सत्स सत्कार करिए वह और माने कि | अच्छे से देखभाल करिए सेवाकार करिए औरना कि |
| iv_hi_055 | held-out | hi | routing wrong_service: start/withdraw money -> start/check account balance | उससे शरीर भी स्वस्थ रहती हे और भोजन भी अच्छा बनता है और हर तरह का भोजन उस पर बन जाता है | उससे शरीर भी स्वस्थ रहती है और भोजन भी अच्छा बनता है और हर तरह का भोजन उस पर बन जाता है |
| iv_hi_059 | held-out | hi | routing service_invented: no-start/CONTROL -> start/deposit money | रूझान रही है इस तरीके से तरक्की दिलाने में | रुजान रही है इस तरीके से तरक्की दिलाने में |
| iv_hi_071 | held-out | hi | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/BANKING_INTENT | सबसे पहले मुझे ड्राइंग में मुझे कुछ अभ्यास नहीं था बहुत सारी ज़रुरत पड़ी क्योंकि मैं कुछ ठ | सबसे पहले मुझे ड्राइंग में मुझे कुछ अभ्यास नहीं था वहुत सारी ज़रूरत पड़ी क्योंकि मैं कुछ ठ |
| iv_hi_076 | held-out | hi | routing changed_non_service: no-start/BANKING_INTENT -> no-start/KNOWLEDGE_QUESTION | श्रीखंड बनता है जो कि बहुत ही आवश्यक होता है उसके बिना गुड़ी परवा मनाना हम सोच भी नहीं सकत | स््री खंड बनता है जो कि बहुत ही आवश्यक होता है उसके बिना गुड़ी पड़वा मनाना हम सोच भी नहीं  |
| iv_hi_083 | held-out | hi-en | routing changed_non_service: no-start/CONTROL -> no-start/ACKNOWLEDGEMENT | कपड़ा एक दम मज़बूत है बैठने वैठने में एक दम मक्खन के जैसा है सब अच्छा है टी वी तो एक नंबर  | कपड़ा एकदम मजबूत है बैठने वैठने में एकदम मक्खन जैसा है सब अच्छा है टी वी तो एक नंबर का थाप |
| iv_hi_093 | held-out | hi-en | routing service_lost: start/check account balance -> no-start/ACKNOWLEDGEMENT | और हर गाँव में जाके कोई वो जगह हो वहाँ पे अच्छा परफ़ॉर्मस दिखाने से यही सब फ़ायदा होता है  | और हर गाँव में जाके कोई भी जगह हो वहाँ पे अच्छा परफॉमेंस दिखाने से यही सा फ़ायदा होता है क |
| iv_hi_102 | held-out | hi | routing changed_non_service: no-start/ACKNOWLEDGEMENT -> no-start/KNOWLEDGE_QUESTION | अंदर से गरम भी नहीं है और वो सर्दियों के लिए लायक ही नहीं है और गर्मी में तो ठीक है हम उसे | अंदर से गर्म भी नहीं है और वो सर्दियों के लिए लाइक की नहीं है और गर्मी में तो ठीक है हम उस |
| iv_hi_106 | held-out | hi | routing wrong_service: start/withdraw money -> start/deposit money | उनका वेशभूषा पहनावा सब कुछ अलग है उनका इसलिए आदिवासियों में सम्मिलित हैं हमारे जैसे आसपास  | उनका वेेशभऊषा पहनावा सब कुछ अलग है उनका इसलिए आदिवाासियों में सम्मिलित हैं हमारे जैसे आस प |
| iv_hi_116 | held-out | hi-en | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/BANKING_INTENT | वो तो बैंक नहीं जाना पड़ता है हम लोग को जैसे फ़ोनपे चल रहा है तो फ़ोनपे कर दिए या जैसे दूस | तो बैंक नहीं जाना पड़ता है हम लोगों को जैसे फ़ोन पे चल रहा है तो फ़ोन पे कर दिए या जैसे दू |
| iv_hi_124 | held-out | hi | routing changed_non_service: no-start/CONTROL -> no-start/KNOWLEDGE_QUESTION | आइए आपको लेना है तो ले लो आपको मोल भाव नहीं करना है आपको परते में लगा देंगे | आइगी आपको लेना है तो ले लो आपको मूल भव नहीं करना है आपको परसम लगा देिए |
| iv_hi_127 | held-out | hi-en | routing service_invented: no-start/ACKNOWLEDGEMENT -> start/check account balance | अपने कैमरे सी सी टी वी कैमरे से चेक करवा लीजिए | अपने कैमरे सी सी टी वी कैमरे चेक करवा लीजिए |
| iv_hi_131 | held-out | hi | ASR changed the amount (wrong): 4500 -> 2000 | दो हज़ार पच्चीस सौ ले लीजिए बस | दो हजार प्चीस तोौ ले लीजिए बस |
| iv_hi_135 | held-out | hi | routing changed_non_service: no-start/BANKING_INTENT -> no-start/CONTROL | हम कुछ नही लेंगे हमें बस पंखा दीजिए पाँच से का आपका मोल भाव बड़ा ज़्यादा हो जाता है | हम कुछ नहीं लेंगे हम पंखा दीजिए पाँच स का आपका मोल भाव बड़ ज़्यादा हो जाता है |
| iv_hi_136 | held-out | hi-en | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/UNSUPPORTED | मैं बैंक ऑफ बरोदा से मैनेजर बोल रहा हूँ | मैं बैंक ऑफ़ बड़ोदा से मैनेजर बोल रहा हूँ |
| iv_hi_140 | held-out | hi | routing service_invented: no-start/UNSUPPORTED -> start/check account balance | ये बड़ा फव्वारा के पास में है खादी ग्राम उद्योग के से लगी हुई है मेरी दुकान जी | ये बड़ाासवाररा के पास में है खादी ग्राम उद्योग से लगी हुई है मेरी दुकान जी |
| iv_hi_145 | held-out | hi-en | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/CONTROL | यह आजकल इस बार फूल छाप पर देना है फोन | है |
| iv_hi_146 | held-out | hi | routing changed_non_service: no-start/CONTROL -> no-start/KNOWLEDGE_QUESTION | हाँ ठीक है ट्यूबलाइट लगाना है और कायदे से सजाना है इसको आफिस को | हाँ ट टू लाइड लगाना है और कायदे से लगाना है उसको ऑफिस को |
| iv_hi_154 | held-out | hi | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/CONTROL | हमारे यहाँ तरह तरह के हमा | हमारे यहाँ तर तरकी हम |
| iv_hi_157 | held-out | hi | routing service_lost: start/apply for loan -> no-start/KNOWLEDGE_QUESTION | हाँ मेरे तो कांटेक्ट में है दो वे मेरे स्क मेरे स्कूल में भी पढ़ाते हैं समझे | हा मेरे तो कॉन्टैक्ट में दो गो मेरे मेरे स्कूल में भी पढ़ाते हैं समझिए |
| iv_hi_158 | held-out | hi | routing wrong_service: start/apply for loan -> start/open new account | लक्ष्मी नाथ का मंदिर है वहीं पास के बग़ल में | लक्ष्मीनाथ का मंदिर है वहीं पास के बगल में |
| iv_hi_159 | held-out | hi | routing service_invented: no-start/KNOWLEDGE_QUESTION -> start/withdraw money | अरे होल तो हमारा प्रापर्टी का धंधा है बिजनेस है और एक आफिस हमारी और है आपके महाराजगंज में  | अरे भोल तो हमारा प्रॉपर्टी का धंधा है बिजनेस है और ये काफ़ीस हमारी और है आपके महराजगंज में |
| iv_hi_161 | held-out | hi | ASR changed the amount (wrong): 700 -> 750 | हाँ ठीक है साड़े सात सौ प्लस अच्छा स्कोर है आपका मिल जाएगा | हाँ ठीक है साढ़े सात सौ प्लस अच्छा स्कोर है आपकाब मिल जाएगा आप |
| iv_hi_162 | held-out | hi | routing changed_non_service: no-start/KNOWLEDGE_QUESTION -> no-start/CONTROL | कमल खम कमल का फूल लेंगे | कल ख कवल का फू लेंगे |
| iv_hi_165 | held-out | hi | routing changed_non_service: no-start/CONTROL -> no-start/KNOWLEDGE_QUESTION | हाँ एक में पैंकिंग कर दें और दूसरे अलग | हाँ एक में पैकिंग कर दें और दू सेे अलग |
| iv_hi_168 | held-out | hi | routing service_invented: no-start/KNOWLEDGE_QUESTION -> start/withdraw money | हाँ हाँ समझते हैं फिर भी दस परसेंट दीजिए क्योंकि गाँव से है न इसलिए | हाँ हाँ समझते हैं फि भी दस पसेंट दीजिए क्योंकि दाम से है ना इसलिए |
| iv_hi_170 | held-out | hi | routing changed_non_service: no-start/CONTROL -> no-start/KNOWLEDGE_QUESTION | वेल्डिंग और प्लम्बर का जो दो चार और लड़के हैं उन सबको भेज के काम उम करवा देंगे जल्दी से | बेल्डिंग और प्लमबर का जो दो चार लड़का है सब कोो भेज के कामूम करवा देंगे बी |
| iv_hi_176 | held-out | hi | routing changed_non_service: no-start/CONTROL -> no-start/ACKNOWLEDGEMENT | सब सब ताज़े और फ्रेश मिलेंगे | सर सब ताज़े ऑफस |
| iv_hi_191 | held-out | hi-en | routing changed_non_service: no-start/ACKNOWLEDGEMENT -> no-start/CONTROL | जी अरे नहीं भैया बिलकुल बिलकुल आप लोगों की सेवा के लिए बिलकुल फल फ्रूट हम लोग फ्रेश लाते ह | जी अरे नहीं भैया बिल्कुल बिल्कुल आप लोगों की सेवा के लिए बिल्कुल फर् फलूड हम लोग फ्रेश लात |
| iv_hi_192 | held-out | hi | routing service_lost: start/check account balance -> no-start/KNOWLEDGE_QUESTION | फैमिली पैक में एक बड़ा वाला पिक आता है वो मिल जाएगा आपको | फैमिली पैक में बड़ा वाला पिकक आता है वो मिल जाएगा आपको |
| iv_hi_194 | held-out | hi | routing changed_non_service: llm_gate -> no-start/CONTROL | ठीक है मैडम यह ऑर्डर आप मुझे कितनी देर में आप पँहुचा देंगी मेरे एड्रेस पर | ठीक है मैडम ये ऑर्डर आप म के मैं आप प च दगी मैडर |
| iv_hi_195 | held-out | hi | routing wrong_service: start/withdraw money -> start/deposit money | बहुत महंगा सब है कम काहे कइ देय | बहुत महंगा सब है कम का है कईद |
| iv_hi_199 | held-out | hi | routing service_lost: start/apply for loan -> no-start/CONTROL | अच्छा हमको चमेली का एक फूल चाहीं | अच्छा तुमको तंदेली का स्ूल सेिए |

## Limits

- No English audio and no recording with English in Latin script exist on disk: English and Latin-script code-switching are not measured from speech.
- 'Code-mixed' here means English words SPOKEN inside Kannada / Hindi and written in native script in the reference (LOANWORD_MARKERS). It is the only code-mixing the corpus contains.
- Banking clips come from the IndicVoices train split (likely in IndicConformer's training data): optimistic.
- IndicVoices clips are read prompts, mostly clean; branch-counter noise, accents and spontaneous speech are not represented.
- Downstream routing is compared reference-vs-hypothesis through the offline router; the LLM gate is not called, so LLM-gated turns count as unchanged when both sides are gated.
