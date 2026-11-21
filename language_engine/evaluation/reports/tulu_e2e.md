# Tulu end-to-end results

Passed 271, failed 0.
Engine start 4.9 s; process memory at end {'current_mb': 1171.4, 'peak_mb': 1293.1}.

## Audio runs

| Workflow | Sequence | ID | Input mode | ASR transcript | Reply | Step | TTS | xcorr vs input | Turn latency |
|---|---|---|---|---|---|---|---|---|---|
| deposit | D01a-D02a-D03a-D04a | D01a | speech | Yank duddu padare undu? | ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (25056 B) | 0.076 | 2.43 s |
| deposit | D01a-D02a-D03a-D04a | D02a | speech | Slip dethond aand? | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.091 | 0.93 s |
| deposit | D01a-D02a-D03a-D04a | D03a | typed fallback after ASR refusal | — | ಬೊಕ್ಕ ಎತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21744 B) | 0.054 | 1.39 s |
| deposit | D01a-D02a-D03a-D04a | D04a | speech | Slip pura fill malthaand next dada malpodu? | Submit the slip along with the cash. | 4 | 200 (19728 B) | 0.051 | 1.53 s |
| deposit | D01b-D02b-D03b-D04b | D01b | speech | Yank duddu deposit malpodu? | ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (25056 B) | 0.089 | 0.75 s |
| deposit | D01b-D02b-D03b-D04b | D02b | speech | Dethe nana dada malpodu? | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.075 | 0.89 s |
| deposit | D01b-D02b-D03b-D04b | D03b | speech | Yan deposit malpuna amount n olpa bareyodu? | ಬೊಕ್ಕ ಎತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21744 B) | 0.066 | 1.62 s |
| deposit | D01b-D02b-D03b-D04b | D04b | typed fallback after ASR refusal | — | Submit the slip along with the cash. | 4 | 200 (19728 B) | 0.067 | 0.85 s |
| deposit | D01c-D02c-D03a-D04c | D01c | speech | Yank duddu padodu? | ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (25056 B) | 0.069 | 0.64 s |
| deposit | D01c-D02c-D03a-D04c | D02c | speech | Ethe dada malpodu? | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.064 | 0.89 s |
| deposit | D01c-D02c-D03a-D04c | D03a | typed fallback after ASR refusal | — | ಬೊಕ್ಕ ಎತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21744 B) | 0.054 | 1.42 s |
| deposit | D01c-D02c-D03a-D04c | D04c | speech | Yan deposit malpuna amount bareye. Next dada malpodu? | Submit the slip along with the cash. | 4 | 200 (19728 B) | 0.087 | 1.73 s |
| deposit | D01c-D02d-D03b-D04a | D01c | speech | Yank duddu padodu? | ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (25056 B) | 0.069 | 0.64 s |
| deposit | D01c-D02d-D03b-D04a | D02d | speech | Yaan slip dethoni ye ethe dada poora fill malthonodu? | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.058 | 1.46 s |
| deposit | D01c-D02d-D03b-D04a | D03b | speech | Yan deposit malpuna amount n olpa bareyodu? | ಬೊಕ್ಕ ಎತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21744 B) | 0.066 | 1.73 s |
| deposit | D01c-D02d-D03b-D04a | D04a | speech | Slip pura fill malthaand next dada malpodu? | Submit the slip along with the cash. | 4 | 200 (19728 B) | 0.051 | 1.53 s |
| withdraw | W01a-W02a-W03a-W03b-W04a | W01a | typed fallback after ASR refusal | — | ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (19440 B) | 0.219 | 1.85 s |
| withdraw | W01a-W02a-W03a-W03b-W04a | W02a | speech | Account number olpa bareyodu? | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.111 | 1.8 s |
| withdraw | W01a-W02a-W03a-W03b-W04a | W03a | speech | Yaan account number fill malthe? Nana dada malpodu? | ಬೊಕ್ಕ ಯೆತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21888 B) | 0.136 | 2.3 s |
| withdraw | W01a-W02a-W03a-W03b-W04a | W03b | speech | Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan? | ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ. | 4 | 200 (17568 B) | 0.114 | 1.97 s |
| withdraw | W01a-W02a-W03a-W03b-W04a | W04a | typed fallback after ASR refusal | — | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್‌ಗ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪುಲೆ. | 5 | 200 (18288 B) | 0.118 | 2.13 s |
| withdraw | W01b-W02a-W03a-W03b-W04a | W01b | typed fallback after ASR refusal | — | ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (19440 B) | 0.147 | 2.08 s |
| withdraw | W01b-W02a-W03a-W03b-W04a | W02a | speech | Account number olpa bareyodu? | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.111 | 1.63 s |
| withdraw | W01b-W02a-W03a-W03b-W04a | W03a | speech | Yaan account number fill malthe? Nana dada malpodu? | ಬೊಕ್ಕ ಯೆತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21888 B) | 0.137 | 2.03 s |
| withdraw | W01b-W02a-W03a-W03b-W04a | W03b | speech | Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan? | ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ. | 4 | 200 (17568 B) | 0.114 | 2.17 s |
| withdraw | W01b-W02a-W03a-W03b-W04a | W04a | typed fallback after ASR refusal | — | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್‌ಗ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪುಲೆ. | 5 | 200 (18288 B) | 0.119 | 2.11 s |
| withdraw | W01c-W02a-W03a-W03b-W04a | W01c | typed fallback after ASR refusal | — | ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (19440 B) | 0.152 | 2.01 s |
| withdraw | W01c-W02a-W03a-W03b-W04a | W02a | speech | Account number olpa bareyodu? | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.111 | 1.8 s |
| withdraw | W01c-W02a-W03a-W03b-W04a | W03a | speech | Yaan account number fill malthe? Nana dada malpodu? | ಬೊಕ್ಕ ಯೆತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21888 B) | 0.136 | 2.03 s |
| withdraw | W01c-W02a-W03a-W03b-W04a | W03b | speech | Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan? | ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ. | 4 | 200 (17568 B) | 0.113 | 2.0 s |
| withdraw | W01c-W02a-W03a-W03b-W04a | W04a | typed fallback after ASR refusal | — | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್‌ಗ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪುಲೆ. | 5 | 200 (18288 B) | 0.118 | 2.11 s |
| withdraw | W01b-W02b-W03a1-W03b1-W04b | W01b | typed fallback after ASR refusal | — | ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (19440 B) | 0.147 | 2.13 s |
| withdraw | W01b-W02b-W03a1-W03b1-W04b | W02b | speech | yan slip dethonde. Nana dada malpodu | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.05 | 1.08 s |
| withdraw | W01b-W02b-W03a1-W03b1-W04b | W03a1 | typed fallback after ASR refusal | — | ಬೊಕ್ಕ ಯೆತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21888 B) | 0.065 | 0.91 s |
| withdraw | W01b-W02b-W03a1-W03b1-W04b | W03b1 | typed fallback after ASR refusal | — | ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ. | 4 | 200 (17568 B) | 0.078 | 0.9 s |
| withdraw | W01b-W02b-W03a1-W03b1-W04b | W04b | typed fallback after ASR refusal | — | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್‌ಗ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪುಲೆ. | 5 | 200 (18288 B) | 0.105 | 1.03 s |
| withdraw | W01c-W02c-W03a1-W03b2-W04c | W01c | typed fallback after ASR refusal | — | ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (19440 B) | 0.152 | 2.18 s |
| withdraw | W01c-W02c-W03a1-W03b2-W04c | W02c | speech | yan slip dethonde. | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.087 | 0.77 s |
| withdraw | W01c-W02c-W03a1-W03b2-W04c | W03a1 | typed fallback after ASR refusal | — | ಬೊಕ್ಕ ಯೆತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21888 B) | 0.065 | 0.91 s |
| withdraw | W01c-W02c-W03a1-W03b2-W04c | W03b2 | speech | yeth duddu deppodu annd bareye | ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ. | 4 | 200 (17568 B) | 0.077 | 1.16 s |
| withdraw | W01c-W02c-W03a1-W03b2-W04c | W04c | typed fallback after ASR refusal | — | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್‌ಗ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪುಲೆ. | 5 | 200 (18288 B) | 0.095 | 0.85 s |
| withdraw | W01a-W02d-W03a1-W03b2-W04b | W01a | typed fallback after ASR refusal | — | ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 1 | 200 (19440 B) | 0.219 | 1.73 s |
| withdraw | W01a-W02d-W03a1-W03b2-W04b | W02d | typed fallback after ASR refusal | — | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 2 | 200 (18144 B) | 0.076 | 1.14 s |
| withdraw | W01a-W02d-W03a1-W03b2-W04b | W03a1 | typed fallback after ASR refusal | — | ಬೊಕ್ಕ ಯೆತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3 | 200 (21888 B) | 0.065 | 0.83 s |
| withdraw | W01a-W02d-W03a1-W03b2-W04b | W03b2 | speech | yeth duddu deppodu annd bareye | ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ. | 4 | 200 (17568 B) | 0.077 | 1.18 s |
| withdraw | W01a-W02d-W03a1-W03b2-W04b | W04b | typed fallback after ASR refusal | — | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್‌ಗ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪುಲೆ. | 5 | 200 (18288 B) | 0.105 | 0.97 s |

## All checks

- PASS deposit audio D01a-D02a-D03a-D04a: D01a (speech) -> step 1
- PASS   D01a: accepted transcript is a verified utterance with the same meaning
- PASS   D01a: /tts returned newly generated MP3
- PASS   D01a: generated audio is not any dataset recording (SHA-256)
- PASS   D01a: generated audio is not the input recording (xcorr 0.076 < 0.5)
- PASS deposit audio D01a-D02a-D03a-D04a: D02a (speech) -> step 2
- PASS   D02a: accepted transcript is a verified utterance with the same meaning
- PASS   D02a: /tts returned newly generated MP3
- PASS   D02a: generated audio is not any dataset recording (SHA-256)
- PASS   D02a: generated audio is not the input recording (xcorr 0.091 < 0.5)
- PASS deposit audio D01a-D02a-D03a-D04a: D03a (typed fallback after ASR refusal) -> step 3
- PASS   D03a: /tts returned newly generated MP3
- PASS   D03a: generated audio is not any dataset recording (SHA-256)
- PASS   D03a: generated audio is not the input recording (xcorr 0.054 < 0.5)
- PASS deposit audio D01a-D02a-D03a-D04a: D04a (speech) -> step 4
- PASS   D04a: accepted transcript is a verified utterance with the same meaning
- PASS   D04a: /tts returned newly generated MP3
- PASS   D04a: generated audio is not any dataset recording (SHA-256)
- PASS   D04a: generated audio is not the input recording (xcorr 0.051 < 0.5)
- PASS deposit audio D01b-D02b-D03b-D04b: D01b (speech) -> step 1
- PASS   D01b: accepted transcript is a verified utterance with the same meaning
- PASS   D01b: /tts returned newly generated MP3
- PASS   D01b: generated audio is not any dataset recording (SHA-256)
- PASS   D01b: generated audio is not the input recording (xcorr 0.089 < 0.5)
- PASS deposit audio D01b-D02b-D03b-D04b: D02b (speech) -> step 2
- PASS   D02b: accepted transcript is a verified utterance with the same meaning
- PASS   D02b: /tts returned newly generated MP3
- PASS   D02b: generated audio is not any dataset recording (SHA-256)
- PASS   D02b: generated audio is not the input recording (xcorr 0.075 < 0.5)
- PASS deposit audio D01b-D02b-D03b-D04b: D03b (speech) -> step 3
- PASS   D03b: accepted transcript is a verified utterance with the same meaning
- PASS   D03b: /tts returned newly generated MP3
- PASS   D03b: generated audio is not any dataset recording (SHA-256)
- PASS   D03b: generated audio is not the input recording (xcorr 0.066 < 0.5)
- PASS deposit audio D01b-D02b-D03b-D04b: D04b (typed fallback after ASR refusal) -> step 4
- PASS   D04b: /tts returned newly generated MP3
- PASS   D04b: generated audio is not any dataset recording (SHA-256)
- PASS   D04b: generated audio is not the input recording (xcorr 0.067 < 0.5)
- PASS deposit audio D01c-D02c-D03a-D04c: D01c (speech) -> step 1
- PASS   D01c: accepted transcript is a verified utterance with the same meaning
- PASS   D01c: /tts returned newly generated MP3
- PASS   D01c: generated audio is not any dataset recording (SHA-256)
- PASS   D01c: generated audio is not the input recording (xcorr 0.069 < 0.5)
- PASS deposit audio D01c-D02c-D03a-D04c: D02c (speech) -> step 2
- PASS   D02c: accepted transcript is a verified utterance with the same meaning
- PASS   D02c: /tts returned newly generated MP3
- PASS   D02c: generated audio is not any dataset recording (SHA-256)
- PASS   D02c: generated audio is not the input recording (xcorr 0.064 < 0.5)
- PASS deposit audio D01c-D02c-D03a-D04c: D03a (typed fallback after ASR refusal) -> step 3
- PASS   D03a: /tts returned newly generated MP3
- PASS   D03a: generated audio is not any dataset recording (SHA-256)
- PASS   D03a: generated audio is not the input recording (xcorr 0.054 < 0.5)
- PASS deposit audio D01c-D02c-D03a-D04c: D04c (speech) -> step 4
- PASS   D04c: accepted transcript is a verified utterance with the same meaning
- PASS   D04c: /tts returned newly generated MP3
- PASS   D04c: generated audio is not any dataset recording (SHA-256)
- PASS   D04c: generated audio is not the input recording (xcorr 0.087 < 0.5)
- PASS deposit audio D01c-D02d-D03b-D04a: D01c (speech) -> step 1
- PASS   D01c: accepted transcript is a verified utterance with the same meaning
- PASS   D01c: /tts returned newly generated MP3
- PASS   D01c: generated audio is not any dataset recording (SHA-256)
- PASS   D01c: generated audio is not the input recording (xcorr 0.069 < 0.5)
- PASS deposit audio D01c-D02d-D03b-D04a: D02d (speech) -> step 2
- PASS   D02d: accepted transcript is a verified utterance with the same meaning
- PASS   D02d: /tts returned newly generated MP3
- PASS   D02d: generated audio is not any dataset recording (SHA-256)
- PASS   D02d: generated audio is not the input recording (xcorr 0.058 < 0.5)
- PASS deposit audio D01c-D02d-D03b-D04a: D03b (speech) -> step 3
- PASS   D03b: accepted transcript is a verified utterance with the same meaning
- PASS   D03b: /tts returned newly generated MP3
- PASS   D03b: generated audio is not any dataset recording (SHA-256)
- PASS   D03b: generated audio is not the input recording (xcorr 0.066 < 0.5)
- PASS deposit audio D01c-D02d-D03b-D04a: D04a (speech) -> step 4
- PASS   D04a: accepted transcript is a verified utterance with the same meaning
- PASS   D04a: /tts returned newly generated MP3
- PASS   D04a: generated audio is not any dataset recording (SHA-256)
- PASS   D04a: generated audio is not the input recording (xcorr 0.051 < 0.5)
- PASS deposit typed D01a 'Yank duddu padare undu?' -> step 1
- PASS deposit typed D02b 'Dethe nana dada malpodu?' -> step 2
- PASS deposit typed D03b 'Yan deposit malpuna amount n olpa bareyodu?' -> step 3
- PASS deposit typed D04b 'Amount n bareye.' -> step 4
- PASS deposit typed D01b 'Yank duddu deposit malpodu?' -> step 1
- PASS deposit typed D02c 'Ethe dada malpodu?' -> step 2
- PASS deposit typed D03a 'Account number fill malthaand, nana dada malpodu?' -> step 3
- PASS deposit typed D04c 'Yan deposit malpuna amount bareye. Next dada malpodu?' -> step 4
- PASS deposit typed D01c 'Yank duddu padodu?' -> step 1
- PASS deposit typed D02d 'Yaan slip dethoni ye ethe dada poora fill malthonodu?' -> step 2
- PASS deposit typed D03a 'Account number fill malthaand, nana dada malpodu?' -> step 3
- PASS deposit typed D04a 'Slip pura fill malthaand next dada malpodu?' -> step 4
- PASS deposit typed D01a 'Yank duddu padare undu?' -> step 1
- PASS deposit typed D02a 'Slip dethond aand?' -> step 2
- PASS deposit typed D03b 'Yan deposit malpuna amount n olpa bareyodu?' -> step 3
- PASS deposit typed D04a 'Slip pura fill malthaand next dada malpodu?' -> step 4
- PASS withdraw audio W01a-W02a-W03a-W03b-W04a: W01a (typed fallback after ASR refusal) -> step 1
- PASS   W01a: /tts returned newly generated MP3
- PASS   W01a: generated audio is not any dataset recording (SHA-256)
- PASS   W01a: generated audio is not the input recording (xcorr 0.219 < 0.5)
- PASS withdraw audio W01a-W02a-W03a-W03b-W04a: W02a (speech) -> step 2
- PASS   W02a: accepted transcript is a verified utterance with the same meaning
- PASS   W02a: /tts returned newly generated MP3
- PASS   W02a: generated audio is not any dataset recording (SHA-256)
- PASS   W02a: generated audio is not the input recording (xcorr 0.111 < 0.5)
- PASS withdraw audio W01a-W02a-W03a-W03b-W04a: W03a (speech) -> step 3
- PASS   W03a: accepted transcript is a verified utterance with the same meaning
- PASS   W03a: /tts returned newly generated MP3
- PASS   W03a: generated audio is not any dataset recording (SHA-256)
- PASS   W03a: generated audio is not the input recording (xcorr 0.136 < 0.5)
- PASS withdraw audio W01a-W02a-W03a-W03b-W04a: W03b (speech) -> step 4
- PASS   W03b: accepted transcript is a verified utterance with the same meaning
- PASS   W03b: /tts returned newly generated MP3
- PASS   W03b: generated audio is not any dataset recording (SHA-256)
- PASS   W03b: generated audio is not the input recording (xcorr 0.114 < 0.5)
- PASS withdraw audio W01a-W02a-W03a-W03b-W04a: W04a (typed fallback after ASR refusal) -> step 5
- PASS   W04a: /tts returned newly generated MP3
- PASS   W04a: generated audio is not any dataset recording (SHA-256)
- PASS   W04a: generated audio is not the input recording (xcorr 0.118 < 0.5)
- PASS withdraw audio W01b-W02a-W03a-W03b-W04a: W01b (typed fallback after ASR refusal) -> step 1
- PASS   W01b: /tts returned newly generated MP3
- PASS   W01b: generated audio is not any dataset recording (SHA-256)
- PASS   W01b: generated audio is not the input recording (xcorr 0.147 < 0.5)
- PASS withdraw audio W01b-W02a-W03a-W03b-W04a: W02a (speech) -> step 2
- PASS   W02a: accepted transcript is a verified utterance with the same meaning
- PASS   W02a: /tts returned newly generated MP3
- PASS   W02a: generated audio is not any dataset recording (SHA-256)
- PASS   W02a: generated audio is not the input recording (xcorr 0.111 < 0.5)
- PASS withdraw audio W01b-W02a-W03a-W03b-W04a: W03a (speech) -> step 3
- PASS   W03a: accepted transcript is a verified utterance with the same meaning
- PASS   W03a: /tts returned newly generated MP3
- PASS   W03a: generated audio is not any dataset recording (SHA-256)
- PASS   W03a: generated audio is not the input recording (xcorr 0.137 < 0.5)
- PASS withdraw audio W01b-W02a-W03a-W03b-W04a: W03b (speech) -> step 4
- PASS   W03b: accepted transcript is a verified utterance with the same meaning
- PASS   W03b: /tts returned newly generated MP3
- PASS   W03b: generated audio is not any dataset recording (SHA-256)
- PASS   W03b: generated audio is not the input recording (xcorr 0.114 < 0.5)
- PASS withdraw audio W01b-W02a-W03a-W03b-W04a: W04a (typed fallback after ASR refusal) -> step 5
- PASS   W04a: /tts returned newly generated MP3
- PASS   W04a: generated audio is not any dataset recording (SHA-256)
- PASS   W04a: generated audio is not the input recording (xcorr 0.119 < 0.5)
- PASS withdraw audio W01c-W02a-W03a-W03b-W04a: W01c (typed fallback after ASR refusal) -> step 1
- PASS   W01c: /tts returned newly generated MP3
- PASS   W01c: generated audio is not any dataset recording (SHA-256)
- PASS   W01c: generated audio is not the input recording (xcorr 0.152 < 0.5)
- PASS withdraw audio W01c-W02a-W03a-W03b-W04a: W02a (speech) -> step 2
- PASS   W02a: accepted transcript is a verified utterance with the same meaning
- PASS   W02a: /tts returned newly generated MP3
- PASS   W02a: generated audio is not any dataset recording (SHA-256)
- PASS   W02a: generated audio is not the input recording (xcorr 0.111 < 0.5)
- PASS withdraw audio W01c-W02a-W03a-W03b-W04a: W03a (speech) -> step 3
- PASS   W03a: accepted transcript is a verified utterance with the same meaning
- PASS   W03a: /tts returned newly generated MP3
- PASS   W03a: generated audio is not any dataset recording (SHA-256)
- PASS   W03a: generated audio is not the input recording (xcorr 0.136 < 0.5)
- PASS withdraw audio W01c-W02a-W03a-W03b-W04a: W03b (speech) -> step 4
- PASS   W03b: accepted transcript is a verified utterance with the same meaning
- PASS   W03b: /tts returned newly generated MP3
- PASS   W03b: generated audio is not any dataset recording (SHA-256)
- PASS   W03b: generated audio is not the input recording (xcorr 0.113 < 0.5)
- PASS withdraw audio W01c-W02a-W03a-W03b-W04a: W04a (typed fallback after ASR refusal) -> step 5
- PASS   W04a: /tts returned newly generated MP3
- PASS   W04a: generated audio is not any dataset recording (SHA-256)
- PASS   W04a: generated audio is not the input recording (xcorr 0.118 < 0.5)
- PASS withdraw audio W01b-W02b-W03a1-W03b1-W04b: W01b (typed fallback after ASR refusal) -> step 1
- PASS   W01b: /tts returned newly generated MP3
- PASS   W01b: generated audio is not any dataset recording (SHA-256)
- PASS   W01b: generated audio is not the input recording (xcorr 0.147 < 0.5)
- PASS withdraw audio W01b-W02b-W03a1-W03b1-W04b: W02b (speech) -> step 2
- PASS   W02b: accepted transcript is a verified utterance with the same meaning
- PASS   W02b: /tts returned newly generated MP3
- PASS   W02b: generated audio is not any dataset recording (SHA-256)
- PASS   W02b: generated audio is not the input recording (xcorr 0.050 < 0.5)
- PASS withdraw audio W01b-W02b-W03a1-W03b1-W04b: W03a1 (typed fallback after ASR refusal) -> step 3
- PASS   W03a1: /tts returned newly generated MP3
- PASS   W03a1: generated audio is not any dataset recording (SHA-256)
- PASS   W03a1: generated audio is not the input recording (xcorr 0.065 < 0.5)
- PASS withdraw audio W01b-W02b-W03a1-W03b1-W04b: W03b1 (typed fallback after ASR refusal) -> step 4
- PASS   W03b1: /tts returned newly generated MP3
- PASS   W03b1: generated audio is not any dataset recording (SHA-256)
- PASS   W03b1: generated audio is not the input recording (xcorr 0.078 < 0.5)
- PASS withdraw audio W01b-W02b-W03a1-W03b1-W04b: W04b (typed fallback after ASR refusal) -> step 5
- PASS   W04b: /tts returned newly generated MP3
- PASS   W04b: generated audio is not any dataset recording (SHA-256)
- PASS   W04b: generated audio is not the input recording (xcorr 0.105 < 0.5)
- PASS withdraw audio W01c-W02c-W03a1-W03b2-W04c: W01c (typed fallback after ASR refusal) -> step 1
- PASS   W01c: /tts returned newly generated MP3
- PASS   W01c: generated audio is not any dataset recording (SHA-256)
- PASS   W01c: generated audio is not the input recording (xcorr 0.152 < 0.5)
- PASS withdraw audio W01c-W02c-W03a1-W03b2-W04c: W02c (speech) -> step 2
- PASS   W02c: accepted transcript is a verified utterance with the same meaning
- PASS   W02c: /tts returned newly generated MP3
- PASS   W02c: generated audio is not any dataset recording (SHA-256)
- PASS   W02c: generated audio is not the input recording (xcorr 0.087 < 0.5)
- PASS withdraw audio W01c-W02c-W03a1-W03b2-W04c: W03a1 (typed fallback after ASR refusal) -> step 3
- PASS   W03a1: /tts returned newly generated MP3
- PASS   W03a1: generated audio is not any dataset recording (SHA-256)
- PASS   W03a1: generated audio is not the input recording (xcorr 0.065 < 0.5)
- PASS withdraw audio W01c-W02c-W03a1-W03b2-W04c: W03b2 (speech) -> step 4
- PASS   W03b2: accepted transcript is a verified utterance with the same meaning
- PASS   W03b2: /tts returned newly generated MP3
- PASS   W03b2: generated audio is not any dataset recording (SHA-256)
- PASS   W03b2: generated audio is not the input recording (xcorr 0.077 < 0.5)
- PASS withdraw audio W01c-W02c-W03a1-W03b2-W04c: W04c (typed fallback after ASR refusal) -> step 5
- PASS   W04c: /tts returned newly generated MP3
- PASS   W04c: generated audio is not any dataset recording (SHA-256)
- PASS   W04c: generated audio is not the input recording (xcorr 0.095 < 0.5)
- PASS withdraw audio W01a-W02d-W03a1-W03b2-W04b: W01a (typed fallback after ASR refusal) -> step 1
- PASS   W01a: /tts returned newly generated MP3
- PASS   W01a: generated audio is not any dataset recording (SHA-256)
- PASS   W01a: generated audio is not the input recording (xcorr 0.219 < 0.5)
- PASS withdraw audio W01a-W02d-W03a1-W03b2-W04b: W02d (typed fallback after ASR refusal) -> step 2
- PASS   W02d: /tts returned newly generated MP3
- PASS   W02d: generated audio is not any dataset recording (SHA-256)
- PASS   W02d: generated audio is not the input recording (xcorr 0.076 < 0.5)
- PASS withdraw audio W01a-W02d-W03a1-W03b2-W04b: W03a1 (typed fallback after ASR refusal) -> step 3
- PASS   W03a1: /tts returned newly generated MP3
- PASS   W03a1: generated audio is not any dataset recording (SHA-256)
- PASS   W03a1: generated audio is not the input recording (xcorr 0.065 < 0.5)
- PASS withdraw audio W01a-W02d-W03a1-W03b2-W04b: W03b2 (speech) -> step 4
- PASS   W03b2: accepted transcript is a verified utterance with the same meaning
- PASS   W03b2: /tts returned newly generated MP3
- PASS   W03b2: generated audio is not any dataset recording (SHA-256)
- PASS   W03b2: generated audio is not the input recording (xcorr 0.077 < 0.5)
- PASS withdraw audio W01a-W02d-W03a1-W03b2-W04b: W04b (typed fallback after ASR refusal) -> step 5
- PASS   W04b: /tts returned newly generated MP3
- PASS   W04b: generated audio is not any dataset recording (SHA-256)
- PASS   W04b: generated audio is not the input recording (xcorr 0.105 < 0.5)
- PASS withdraw typed W01a 'Yenk kaas deppere undu?' -> step 1
- PASS withdraw typed W02a 'Account number olpa bareyodu?' -> step 2
- PASS withdraw typed W03a 'Yaan account number fill malthe? Nana dada malpodu?' -> step 3
- PASS withdraw typed W03b 'Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan?' -> step 4
- PASS withdraw typed W04a 'Yaan slip g sign padeye? Eth ol submit malpodu?' -> step 5
- PASS withdraw typed W01b 'Yenk yenna account d dh kaas/amount deppere undu?' -> step 1
- PASS withdraw typed W02a 'Account number olpa bareyodu?' -> step 2
- PASS withdraw typed W03a 'Yaan account number fill malthe? Nana dada malpodu?' -> step 3
- PASS withdraw typed W03b 'Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan?' -> step 4
- PASS withdraw typed W04a 'Yaan slip g sign padeye? Eth ol submit malpodu?' -> step 5
- PASS withdraw typed W01c 'Yenk bank dh kaas deppere undu?' -> step 1
- PASS withdraw typed W02a 'Account number olpa bareyodu?' -> step 2
- PASS withdraw typed W03a 'Yaan account number fill malthe? Nana dada malpodu?' -> step 3
- PASS withdraw typed W03b 'Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan?' -> step 4
- PASS withdraw typed W04a 'Yaan slip g sign padeye? Eth ol submit malpodu?' -> step 5
- PASS withdraw typed W01a 'Yenk kaas deppere undu?' -> step 1
- PASS withdraw typed W02b 'yan slip dethonde. Nana dada malpodu' -> step 2
- PASS withdraw typed W03a1 'account number bareye.' -> step 3
- PASS withdraw typed W03b1 'amount n bareye' -> step 4
- PASS withdraw typed W04b 'slip gu sign padiye.' -> step 5
- PASS withdraw typed W01c 'Yenk bank dh kaas deppere undu?' -> step 1
- PASS withdraw typed W02c 'yan slip dethonde.' -> step 2
- PASS withdraw typed W03a1 'account number bareye.' -> step 3
- PASS withdraw typed W03b2 'yeth duddu deppodu annd bareye' -> step 4
- PASS withdraw typed W04c 'sign padiye.' -> step 5
- PASS withdraw typed W01b 'Yenk yenna account d dh kaas/amount deppere undu?' -> step 1
- PASS withdraw typed W02d 'slip dethon d annd.' -> step 2
- PASS withdraw typed W03a 'Yaan account number fill malthe? Nana dada malpodu?' -> step 3
- PASS withdraw typed W03b2 'yeth duddu deppodu annd bareye' -> step 4
- PASS withdraw typed W04b 'slip gu sign padiye.' -> step 5
- PASS deposit-set progress phrase advances a WITHDRAWAL visit (neutral pivot), no conflict
- PASS probe 'Yank duddu deppere undu?' rejected as ambiguous: clarification, no workflow started
- PASS probe with both service verbs rejected as ambiguous
- PASS loan in a Tulu session: existing workflow started
- PASS loan reply is English, not presented as Tulu
- PASS loan reply still spoken (English voice), 200
- PASS deposit step 4 (disputed D04) answered in English
- PASS English deposit -> English step 1
- PASS English withdraw -> English step 1
- PASS Kannada deposit -> Kannada catalog step 1 (not Tulu)
- PASS Kannada /tts unchanged
- PASS unsupported language still refused by /tts (400)
- PASS /tulu/capabilities lists deposit and withdraw
- PASS /tulu/tts generated audio + disclosure header
- PASS /tulu/understand W01c -> withdraw
