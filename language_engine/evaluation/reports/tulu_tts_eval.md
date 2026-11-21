# Tulu TTS evaluation

**Voice:** Kannada-trained neural voice synthesizing Tulu text written in Kannada script; not a native Tulu TTS model.

- Generated items: 30
- Any generated file byte-identical (SHA-256) to a dataset recording: False
- Highest waveform cross-correlation between any generated file and any dataset recording: 0.346 (identical audio = 1.0)

## Machine-intelligibility proxy (Kannada ASR round trip; lower CER = closer to the Romanized text)

| ASR | Mean CER, generated (28 sentences) | Mean CER, native speakers (same 28) | Mean CER, generated (8 product responses) |
|---|---|---|---|
| indicconformer-kn | 0.348 | 0.273 | 0.355 |

## Per item

| ID | Status | Romanized | Spoken (Kannada script) | Dur. | Max xcorr vs dataset | indicconformer-kn CER gen / native |
|---|---|---|---|---|---|---|
| D01a | verified | Yank duddu padare undu? | ಯಂಕ್ ದುಡ್ಡು ಪಡರೆ ಉಂಡು? | 2.45 s | 0.215 | 0.278 / 0.0 |
| D01b | verified | Yank duddu deposit malpodu? | ಯಂಕ್ ದುಡ್ಡು ಡೆಪಾಸಿಟ್ ಮಲ್ಪೊಡು? | 2.76 s | 0.213 | 0.227 / 0.091 |
| D01c | verified | Yank duddu padodu? | ಯಂಕ್ ದುಡ್ಡು ಪಡೊಡು? | 2.26 s | 0.195 | 0.357 / 0.286 |
| D01 | verified | Okay, first er cash deposit dh slip dethonle. | ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 4.18 s | 0.168 | 0.333 / 0.545 |
| D02a | verified | Slip dethond aand? | ಸ್ಲಿಪ್ ದೆತೊಂಡ್ ಆಂಡ್? | 2.26 s | 0.346 | 0.385 / 0.154 |
| D02b | verified | Dethe nana dada malpodu? | ದೆತೆ ನನ ದಡ ಮಲ್ಪೊಡು? | 2.64 s | 0.179 | 0.263 / 0.053 |
| D02c | verified | Ethe dada malpodu? | ಎತೆ ದಡ ಮಲ್ಪೊಡು? | 2.33 s | 0.134 | 0.429 / 0.214 |
| D02d | verified | Yaan slip dethoni ye ethe dada poora fill malthonodu? | ಯಾನ್ ಸ್ಲಿಪ್ ದೆತೊನಿ ಯೆ ಎತೆ ದಡ ಪೂರ ಫಿಲ್ ಮಲ್ತೊನೊಡು? | 4.03 s | 0.163 | 0.263 / 0.184 |
| D02 | verified | Ait erna account number barele. | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 3.02 s | 0.169 | 0.36 / 0.28 |
| D03a | verified | Account number fill malthaand, nana dada malpodu? | ಅಕೌಂಟ್ ನಂಬರ್ ಫಿಲ್ ಮಲ್ತಾಂಡ್, ನನ ದಡ ಮಲ್ಪೊಡು? | 3.82 s | 0.171 | 0.27 / 0.216 |
| D03b | verified | Yan deposit malpuna amount n olpa bareyodu? | ಯನ್ ಡೆಪಾಸಿಟ್ ಮಲ್ಪುನ ಅಮೌಂಟ್‌ನ್ ಒಲ್ಪ ಬರೆಯೊಡು? | 3.5 s | 0.222 | 0.333 / 0.25 |
| D03 | verified | Bokka eth amount deppere undu aven barele. | ಬೊಕ್ಕ ಎತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3.62 s | 0.168 | 0.312 / 0.25 |
| D04a | verified | Slip pura fill malthaand next dada malpodu? | ಸ್ಲಿಪ್ ಪುರ ಫಿಲ್ ಮಲ್ತಾಂಡ್ ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು? | 3.65 s | 0.12 | 0.206 / 0.088 |
| D04b | verified | Amount n bareye. | ಅಮೌಂಟ್‌ನ್ ಬರೆಯೆ. | 2.23 s | 0.208 | 0.692 / 0.462 |
| D04c | verified | Yan deposit malpuna amount bareye. Next dada malpodu? | ಯನ್ ಡೆಪಾಸಿಟ್ ಮಲ್ಪುನ ಅಮೌಂಟ್ ಬರೆಯೆ. ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು? | 5.26 s | 0.234 | 0.267 / 0.222 |
| D04 | disputed -- listening only | Slip Boka amount n cash counter d korle. | ಸ್ಲಿಪ್ ಬೊಕ ಅಮೌಂಟ್‌ನ್ ಕ್ಯಾಶ್ ಕೌಂಟರ್‌ಡ್ ಕೊರ್ಲೆ. | 3.53 s | 0.158 | 0.355 / 0.323 |
| W01a | verified | Yenk kaas deppere undu? | ಯೆಂಕ್ ಕಾಸ್ ದೆಪ್ಪೆರೆ ಉಂಡು? | 2.57 s | 0.201 | 0.471 / 0.471 |
| W01b | verified | Yenk yenna account d dh kaas/amount deppere undu? | ಯೆಂಕ್ ಯೆನ್ನ ಅಕೌಂಟ್‌ಡ್‌ದ ಕಾಸ್/ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು? | 3.74 s | 0.309 | 0.371 / 0.429 |
| W01c | verified | Yenk bank dh kaas deppere undu? | ಯೆಂಕ್ ಬ್ಯಾಂಕ್‌ದ ಕಾಸ್ ದೆಪ್ಪೆರೆ ಉಂಡು? | 2.93 s | 0.181 | 0.364 / 0.364 |
| W01 | verified | Sari..alpa withdrawal slip dethonle. | ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | 3.24 s | 0.22 | 0.393 / 0.357 |
| W02a | verified | Account number olpa bareyodu? | ಅಕೌಂಟ್ ನಂಬರ್ ಒಲ್ಪ ಬರೆಯೊಡು? | 2.78 s | 0.118 | 0.417 / 0.167 |
| W02 | verified | Ait erna account number barele. | ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. | 3.02 s | 0.168 | 0.36 / 0.36 |
| W03a | verified | Yaan account number fill malthe? Nana dada malpodu? | ಯಾನ್ ಅಕೌಂಟ್ ನಂಬರ್ ಫಿಲ್ ಮಲ್ತೆ? ನನ ದಡ ಮಲ್ಪೊಡು? | 4.82 s | 0.173 | 0.289 / 0.158 |
| W03 | verified | Bokka yeth amount deppere undu aven barele. | ಬೊಕ್ಕ ಯೆತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ. | 3.65 s | 0.158 | 0.424 / 0.303 |
| W03b | verified | Yaan yeth kaas deppodu andh barethe? Nana dada malpodu yaan? | ಯಾನ್ ಯೆತ್ ಕಾಸ್ ದೆಪ್ಪೊಡು ಅಂದ್ ಬರೆತೆ? ನನ ದಡ ಮಲ್ಪೊಡು ಯಾನ್? | 5.28 s | 0.175 | 0.31 / 0.214 |
| W04 | verified | Withdrawal slip-g sign malpule. | ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ. | 2.93 s | 0.182 | 0.28 / 0.4 |
| W04a | verified | Yaan slip g sign padeye? Eth ol submit malpodu? | ಯಾನ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಪಡೆಯೆ? ಎತ್ ಒಲ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪೊಡು? | 4.58 s | 0.168 | 0.371 / 0.543 |
| W05 | verified | Slip cashier-g submit malpule. | ಸ್ಲಿಪ್ ಕ್ಯಾಶಿಯರ್‌ಗ್ ಸಬ್ಮಿಟ್ ಮಲ್ಪುಲೆ. | 3.05 s | 0.141 | 0.375 / 0.25 |
| D04-disputed-v1 | disputed (dataset table, row D04 / Assistant) -- listening only | Slip Boka amount n cash counter d korle. | ಸ್ಲಿಪ್ ಬೊಕ ಅಮೌಂಟ್‌ನ್ ಕ್ಯಾಶ್ ಕೌಂಟರ್‌ಡ್ ಕೊರ್ಲೆ. | 3.53 s | 0.158 | 0.355 / - |
| D04-disputed-v2 | disputed (Workflow and recording notes (stated as the confirmed wording)) -- listening only | Slip Boka amount n korle. | ಸ್ಲಿಪ್ ಬೊಕ ಅಮೌಂಟ್‌ನ್ ಕೊರ್ಲೆ. | 2.83 s | 0.193 | 0.45 / - |
