# Tulu ASR evaluation: indicconformer-kn

Matcher threshold 0.8, ambiguity margin 0.05 (fixed before evaluation). Closed set: verified phrases only.

- model: indicconformer-kn
- recordings_evaluated: 63
- customer_recordings: 48
- empty_outputs: 0
- errors: 0
- mean_cer_all: 0.274
- mean_cer_customer: 0.263
- correct_phrase: 29/48
- correct_meaning_other_phrase: 0/48
- false_acceptance: 0/48
- rejected: 19/48
- loo_correct_meaning: 3/48
- loo_false_acceptance: 0/48
- loo_rejected: 45/48
- mean_latency_s: 1.89
- max_latency_s: 3.54
- total_wall_s: 119.7
- memory_at_start: {'current_mb': 18.0, 'peak_mb': 18.0}
- memory_at_end: {'current_mb': 302.8, 'peak_mb': 400.1}
- stopped: None

| Dataset | correct phrase | correct meaning (other phrase) | false acceptance | rejected |
|---|---|---|---|---|
| deposit | 10/12 | 0/12 | 0/12 | 2/12 |
| withdrawal | 6/15 | 0/15 | 0/15 | 9/15 |
| control | 13/21 | 0/21 | 0/21 | 8/21 |

| ID | Reference | Hypothesis (raw) | CER | Outcome | Matched (score) | LOO | Latency |
|---|---|---|---|---|---|---|---|
| D01a | Yank duddu padare undu? | ಯಂಕ್ ದುಡ್ಡು ಪಾಡರೆ ಉಂದುು | 0.0 | correct_phrase | D01a (1.0) | correct_meaning | 3.54 s |
| D01b | Yank duddu deposit malpodu? | ಯಕ್ ದುಡ್ಡು ಡೆಪಾಸಿಟ್ ಮಲ್ಪೋಡು | 0.091 | correct_phrase | D01b (0.939) | rejected | 0.9 s |
| D01c | Yank duddu padodu? | ಕ್ ದುಡ್ಡು ಪಾಡಡು | 0.286 | correct_phrase | D01c (0.828) | rejected | 0.81 s |
| D01 | Okay, first er cash deposit dh slip dethonle. | ಒಕೆ ಫಸ್ಟ್ ಇರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್ ಮಲ್ಪುನ ಸ್ಲಿಪ್ಗೆ ತೋನ್ | 0.545 | assistant (CER only) | - (-) | - | 3.1 s |
| D02a | Slip dethond aand? | ಸ್ಲಿಪ್ ದ ತೋಂಡಂಡ | 0.154 | correct_phrase | D02a (0.839) | correct_meaning | 0.99 s |
| D02b | Dethe nana dada malpodu? | ಬೆತ್ತೆ ನನದಾದ ಮಲ್ಪೋಡು | 0.053 | correct_phrase | D02b (0.93) | correct_meaning | 1.12 s |
| D02c | Ethe dada malpodu? | ಇದೆ ದಾದ ಮಲ್ಕೋಡು | 0.214 | correct_phrase | D02c (0.812) | rejected | 1.12 s |
| D02d | Yaan slip dethoni ye ethe dada poora fill malthonodu? | ಯನ್ ಸ್ಲಿಪ್ ಗೆಥೋನಿಯೇ ಹಿತೆದಾದಪೂರ ಶಿಲ್ ಮಲ್ಪೋಡು | 0.184 | correct_phrase | D02d (0.841) | rejected | 1.75 s |
| D02 | Ait erna account number barele. | ಹೈಟ್ ಈರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರಲಿ | 0.28 | assistant (CER only) | - (-) | - | 1.33 s |
| D03a | Account number fill malthaand, nana dada malpodu? | ಅಕೌಂಟ್ ನಂಬರ್ ಚಲ್ಮಲ್ ತಾಂಡ ನನದಾದ ಮಲ್ಪುಡು | 0.216 | rejected | - (0.791) | rejected | 1.69 s |
| D03b | Yan deposit malpuna amount n olpa bareyodu? | ಯಾನ ಡೆಪಾಸಿಟ್ ಮಲ್ಪನ ಅಮೌಂಟ್ನ್ನು ಸ್ವಲ್ಪ ಬರೆಯುದುು | 0.25 | correct_phrase | D03b (0.828) | rejected | 2.0 s |
| D03 | Bokka eth amount deppere undu aven barele. | ಬುಕ್ಕ ಏತೆ ಅಮೌಂಟ್ ದಪ್ಪರೆ ಉಂದುು ಅವೇನು ಬರಲಿ | 0.25 | assistant (CER only) | - (-) | - | 1.74 s |
| D04a | Slip pura fill malthaand next dada malpodu? | ಸ್ಲಿಪುರಫಿಲ್ ಮಲ್ತಾಂಡ್ ನೆಕ್ಸ್ಟ್ ದಾದಾ ಮಲ್ಕೋಡು | 0.088 | correct_phrase | D04a (0.909) | rejected | 1.83 s |
| D04b | Amount n bareye. | ಅಮೌಂಟನು ಬರ | 0.462 | rejected | - (0.69) | rejected | 1.1 s |
| D04c | Yan deposit malpuna amount bareye. Next dada malpodu? | ಯನ್ ಡೆಪಾಸಿಟ್ ಮಲ್ಪುನ ಅಮೌಂಟನ ಬರ ನೆಕ್ಸ್ಟದಾದ ಮಲ್ಪುಡು | 0.222 | correct_phrase | D04c (0.857) | rejected | 2.12 s |
| D04 | Slip Boka amount n cash counter d korle. | ಸ್ಲಿಪ್ ಬುಕ್ ಅಮೌಂಟನ ಕ್ಯಾಶ್ ಕೌಂಟರ್ಡ್ ಕೊರಲ | 0.323 | assistant (CER only) | - (-) | - | 1.71 s |
| W01a | Yenk kaas deppere undu? | ಇಂಕ್ ಕಸ್ ದಿರೆ ಉು | 0.471 | rejected | - (0.706) | rejected | 2.22 s |
| W01b | Yenk yenna account d dh kaas/amount deppere undu? | ಯಂಕ್ನ್ನ ಅಕೌಂಟಡ್ ದ ಕಸ್ ದಪ್ಪರ ಉಂಡು | 0.429 | rejected | - (0.701) | rejected | 2.63 s |
| W01c | Yenk bank dh kaas deppere undu? | ಇಂಕ್ ಬ್ಯಾಂಕ್್ದ ಕಸ್ ದಬ್ಬರ ಉಂಡು | 0.364 | rejected | - (0.741) | rejected | 2.47 s |
| W01 | Sari..alpa withdrawal slip dethonle. | ಅಲ್ಪ ವಿಡ್್ರಾಲ್ ಸ್ಲಿಪ್ ದ ತೊಂದಲೆ | 0.357 | assistant (CER only) | - (-) | - | 2.55 s |
| W02a | Account number olpa bareyodu? | ಅಕೌಂಟ್ ನಂಬರ್ ಒಲ್ಪ ಬರೆಯೋಡು | 0.167 | correct_phrase | W02a (0.852) | rejected | 2.13 s |
| W02b | yan slip dethonde. Nana dada malpodu | ಯಾನ ಸ್ಲಿಪ್ಪ ದ ತೊಂಡೆ ನನದಾದ ಮಲ್ಪೋಡು | 0.103 | correct_phrase | W02b (0.914) | rejected | 1.33 s |
| W02c | yan slip dethonde. | ಯಾನ ಸ್ಲಿಪ್ಪ ದೆ ತುೊಂಡೆ | 0.214 | correct_phrase | W02c (0.889) | rejected | 1.02 s |
| W02d | slip dethon d annd. | ಸ್ಿಪ್ ಜತ್ೊಂದು ಆಂಡ | 0.385 | rejected | - (0.774) | rejected | 1.41 s |
| W02 | Ait erna account number barele. | ಟಿರ್ ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರಲಿ | 0.36 | assistant (CER only) | - (-) | - | 2.28 s |
| W03a | Yaan account number fill malthe? Nana dada malpodu? | ಯನ್ ಅಕೌಂಟ್ ನಂಬರ್ ಫಿಲ್ಮ ಅಲ್ತೆ ನನ್ನದಾದ ಮಲ್ಪೋಡು | 0.158 | correct_phrase | W03a (0.844) | rejected | 2.53 s |
| W03a1 | account number bareye. | ಅಕೌಂಟ್ ನಂಬರ್ ಬರೇ | 0.333 | rejected | - (0.737) | rejected | 1.11 s |
| W03 | Bokka yeth amount deppere undu aven barele. | ಬುಕ್ ಏತ್ ಅಮೌಂಟ್ ದಪ್ಪರಿ ಉಂಡು ಅವನ್ ಬರಲಿ | 0.303 | assistant (CER only) | - (-) | - | 2.43 s |
| W03b | Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan? | ಏತ್ ಕಸ್ ದೆಪ್ಪುಡಂದು ಬರೆತೆ ನನ್ನದಾದ ಮಲ್ಪೋಡ ಯಾನು | 0.214 | correct_phrase | W03b (0.854) | rejected | 2.56 s |
| W03b1 | amount n bareye | ಅಮೌಂಟ್ನ್ನು ಬರ | 0.385 | rejected | - (0.714) | rejected | 1.14 s |
| W03b2 | yeth duddu deppodu annd bareye | ಏತ ದುಡ್ಡುಗೆಪ್ಪಡು ಅಂದು ಬರೆಯ | 0.273 | correct_phrase | W03b2 (0.808) | rejected | 1.44 s |
| W04 | Withdrawal slip-g sign malpule. | ಮಚಲ್ ಸ್ಲಿಪ್ಗೆ ಸೈನ್ ಮಲ್ಪಲೆ | 0.4 | assistant (CER only) | - (-) | - | 2.17 s |
| W04a | Yaan slip g sign padeye? Eth ol submit malpodu? | ಸ್ಲಿಪ್ಪಗ ಸೈನ್ ಮಾಡಡಿಿ ಇತ್ತೆ ಹೋಲ್ ಸಬ್ಮಿಟ್ ಮಾಡಬೋಡ | 0.543 | rejected | - (0.628) | rejected | 2.62 s |
| W04b | slip gu sign padiye. | ಸ್ಲಿಪ್ಪಗೆ ಸೈನ್ ಮಾಡೇ | 0.438 | rejected | - (0.722) | rejected | 1.25 s |
| W04c | sign padiye. | ಸೈನ್ ಮಾಡ | 0.6 | rejected | - (0.6) | rejected | 1.08 s |
| W05 | Slip cashier-g submit malpule. | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್ ಗ ಸಬ್ಮಿಟ್ ಮಲ್ಪ್ಲೇ | 0.25 | assistant (CER only) | - (-) | - | 2.44 s |
| C01a | Kuda panoli ya | ಕೂಡ ಕನೋಲಿಯ | 0.167 | correct_phrase | C01a (0.815) | rejected | 1.98 s |
| C01b | Aven kuda panle | ಅವನ್ ಕೂಡ ಬಂದಲ | 0.462 | rejected | - (0.688) | rejected | 1.91 s |
| C01c | Yenk er panni kendhiji sari | ಯಕ್ ಈ ಪನ್ವಿಕೆಂದಜಿ ಸರಿ | 0.238 | correct_phrase | C01c (0.833) | rejected | 2.1 s |
| C01d | Churu mella panle | ಚೂರ್ಮೆಲ್ಲ ಪಲ್ಲೆ | 0.231 | correct_phrase | C01d (0.815) | rejected | 1.99 s |
| C01 | Sari yaan kuda mella panpe. | ಸರಿ ನಾನ್ ಕೂಡಮ್ಮೆಲ್ಲ ಬಂದೇ | 0.2 | assistant (CER only) | - (-) | - | 2.0 s |
| C02a | Churu wait malpule | ಶೂರ್ ವೇಟ್ ಮಲ್ಲೆ | 0.533 | rejected | - (0.621) | rejected | 2.17 s |
| C02b | Churu porth unthule | ಚೂ ಪೊರ್ತು ಉಟಲೆ | 0.357 | rejected | - (0.733) | rejected | 2.0 s |
| C02c | Yenk churu check malpere undu ..er churu porth wait malpule | ಇಕುಚೂರ್ ಚೆಕ್ ಮಲ್ಪರ ಉಂಡು ಈರ್ಚೂರ್ ಪೊತ ವೇಟ್ ಮಲ್ಪಲೆ | 0.364 | rejected | - (0.747) | rejected | 2.87 s |
| C02d | Yaan panpina muta continue malporchi | ಯನ್ ಪಂಪಿನ ಮುಟ ಕಾಂಟಿನಮ ಪುರ್ಚಿ | 0.167 | correct_phrase | C02d (0.848) | rejected | 2.31 s |
| C02e | Yaan panpina muta unthule | ಯ ಪನ್ಪಿನ ಮುಟ ಒಂತಲೆ | 0.15 | correct_phrase | C02e (0.889) | rejected | 1.97 s |
| C02 | Okay ... Er aramse malpule ... yaan er panpina muta unthuve .. | ಓಕೆ ಈರ್ ಆರಾಮಸೆ ಮಾಲ್ಪಲ ನನ್ ಈರ್ ಬಂಪಿನ ಮುಟ ಉಂತುವೆ | 0.171 | assistant (CER only) | - (-) | - | 3.14 s |
| C03a | Eth aav . | ಈ ಯವು | 0.5 | rejected | - (0.727) | rejected | 2.14 s |
| C03b | Nana explain malpodu pandh ejji | ನನ್ನ ಎಕ್ಸ್ಪ್ಲೇನ್ ಮಲ್ಪೋಡು ಬಂದಿಿ | 0.192 | correct_phrase | C03b (0.857) | rejected | 2.38 s |
| C03c | Yenk nana dada help borchi or thank u eth yaav information | ಇಂಕ್ ನನ್ನದಲ್ಲ ಹೆಲ್ಪ್ ಕೊಚ್ಚಿ ಥ್ಯಾಂಕ್ ಯೂ ಈತ್ ಯಾವ ಇನ್ಫೋರ್ಮೇಶನ್ | 0.364 | rejected | - (0.762) | rejected | 2.98 s |
| C03 | Okay ... nana oik andala help bodanda yenk panle ... thank you. | ಓಕ್ಯ್ ನಾನ ವಕಾಂಡಲ್ಲ ಹೆಲ್ಪ ಕಡಂಡ ಇಕ್ ಬಂದಲ ತಾಂಕ ಯು | 0.341 | assistant (CER only) | - (-) | - | 2.94 s |
| C04a | Yenk artha ayiji | ಇಂಕ್ ಅರ್ಥ ಆಯಜಿ | 0.231 | correct_phrase | C04a (0.828) | rejected | 2.14 s |
| C04b | Kuda explain malpoli ya .. | ಕೂಡ ಎಕ್ಸ್ಪ್ಲೇನ್ ಮನಪುಲಯ | 0.333 | rejected | - (0.723) | rejected | 2.28 s |
| C04c | Ancha panda dada | ಅಂಚು ಕಂಡದಾದ | 0.154 | correct_phrase | C04c (0.828) | rejected | 2.28 s |
| C04 | Thondre ejji yaan ereg kuda panpe.. | ತೊಂದರ ಇಚ್ಚಿ ಯಾನ ಇ ಕೂಡ ಬಂತೆ | 0.48 | assistant (CER only) | - (-) | - | 2.53 s |
| C05a | Next dada | ನೆಕ್ಸ್ಟ ದ ದ | 0.111 | correct_phrase | C05a (0.909) | rejected | 0.7 s |
| C05b | Undu ayii bokka dada | ಒಂದು ಆಯಿ ಬೊಕ್ಕ ದಾದ | 0.067 | correct_phrase | C05b (0.944) | rejected | 1.07 s |
| C05c | Next panle | ನೆಕ್ಸ್ಟ್ ಪನ್ಲೆೇ | 0.0 | correct_phrase | C05c (1.0) | rejected | 0.96 s |
| C05d | Next dada malpodu panle | ನೆಕ್ಸ್ಟ ದಾದ ಮಲ್ಪುಡು ಪನ್ಲೆ | 0.095 | correct_phrase | C05d (0.939) | rejected | 1.11 s |
| C05 | Avu next dada malpodu annd panpe. | ಆವು ನೆಕ್ಸ್ಟ್ ದಾದ ಮಲ್ ಪುಡು ಅಂದು ಪನ್ ಪ | 0.111 | assistant (CER only) | - (-) | - | 1.38 s |
| C06a | Continue malpule | ಕಂಟಿನ್ಯೂ ಮನ್ಕೂಲೆ | 0.4 | rejected | - (0.625) | rejected | 1.11 s |
| C06b | Olpa unthayar alpa d continue malpule | ವಲ್ಪ ಉಂತಾಯರು ಅಲ್ಪಡ್್ದ ಕಂಟಿನ್ಯೂ ಮಲ್ಪುಲೆೇ | 0.226 | correct_phrase | C06b (0.838) | rejected | 1.46 s |
| C06 | Avu erna request n continue malpuve. | ಹವು ಈರ್ನರಿಕ್ವೆಸ್ಟ ನ ಕಂಟಿನ್ಯೂ ಮಲ್ಪುವೆ | 0.267 | assistant (CER only) | - (-) | - | 1.48 s |
