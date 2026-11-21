# Tulu conversation-control end-to-end

Passed 110, failed 0. Spoken phrases recognised by ASR: 13/21. LLM calls: 0.

| Mode | ID | Control | Workflow | Input | ASR transcript | Reply | State/step | TTS | xcorr | Latency |
|---|---|---|---|---|---|---|---|---|---|---|
| speech | C01a | REPEAT_STEP | deposit | speech | Kuda panoli ya | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.094 | 3.57 s |
| speech | C01b | REPEAT_STEP | withdraw | typed fallback after ASR refusal | — | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.076 | 1.69 s |
| speech | C01c | REPEAT_STEP | deposit | speech | Yenk er panni kendhiji sari | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.089 | 2.32 s |
| speech | C01d | REPEAT_STEP | withdraw | speech | Churu mella panle | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.119 | 1.97 s |
| speech | C02a | PAUSE_WORKFLOW | deposit | typed fallback after ASR refusal | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.131 | 1.81 s |
| speech | C02b | PAUSE_WORKFLOW | withdraw | typed fallback after ASR refusal | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.101 | 1.57 s |
| speech | C02c | PAUSE_WORKFLOW | deposit | typed fallback after ASR refusal | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.089 | 1.94 s |
| speech | C02d | PAUSE_WORKFLOW | withdraw | speech | Yaan panpina muta continue malporchi | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.077 | 1.77 s |
| speech | C02e | PAUSE_WORKFLOW | deposit | speech | Yaan panpina muta unthule | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.089 | 1.65 s |
| speech | C03a | STOP_REQUEST | withdraw | typed fallback after ASR refusal | — | ಓಕೆ ... ನನ ಒಇಕ್ ಅಂಡಲ ಹೆಲ್ಪ್ ಬೊಡಂಡ ಯೆಂಕ್ ಪನ್ಲೆ ... ಥ್ಯಾಂಕ್ ಯೂ. Say stop again to end the conversation. | cancelled/1 | 200 | 0.083 | 1.65 s |
| speech | C03b | STOP_REQUEST | deposit | speech | Nana explain malpodu pandh ejji | ಓಕೆ ... ನನ ಒಇಕ್ ಅಂಡಲ ಹೆಲ್ಪ್ ಬೊಡಂಡ ಯೆಂಕ್ ಪನ್ಲೆ ... ಥ್ಯಾಂಕ್ ಯೂ. Say stop again to end the conversation. | cancelled/1 | 200 | 0.064 | 2.72 s |
| speech | C03c | STOP_REQUEST | withdraw | typed fallback after ASR refusal | — | ಓಕೆ ... ನನ ಒಇಕ್ ಅಂಡಲ ಹೆಲ್ಪ್ ಬೊಡಂಡ ಯೆಂಕ್ ಪನ್ಲೆ ... ಥ್ಯಾಂಕ್ ಯೂ. Say stop again to end the conversation. | cancelled/1 | 200 | 0.064 | 2.7 s |
| speech | C04a | CLARIFY_CURRENT_STEP | deposit | speech | Yenk artha ayiji | ತೊಂಡ್ರೆ ಎಜ್ಜಿ ಯಾನ್ ಎರೆಗ್ ಕುಡ ಪಂಪೆ.. If anything on this step is unclear, the bank staff can also help you. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.144 | 1.68 s |
| speech | C04b | CLARIFY_CURRENT_STEP | withdraw | typed fallback after ASR refusal | — | ತೊಂಡ್ರೆ ಎಜ್ಜಿ ಯಾನ್ ಎರೆಗ್ ಕುಡ ಪಂಪೆ.. If anything on this step is unclear, the bank staff can also help you. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.081 | 1.88 s |
| speech | C04c | CLARIFY_CURRENT_STEP | deposit | speech | Ancha panda dada | ತೊಂಡ್ರೆ ಎಜ್ಜಿ ಯಾನ್ ಎರೆಗ್ ಕುಡ ಪಂಪೆ.. If anything on this step is unclear, the bank staff can also help you. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.083 | 1.91 s |
| speech | C05a | NEXT_STEP | withdraw | speech | Next dada | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.092 | 0.67 s |
| speech | C05b | NEXT_STEP | deposit | speech | Undu ayii bokka dada | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.071 | 1.0 s |
| speech | C05c | NEXT_STEP | withdraw | speech | Next panle | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.068 | 1.03 s |
| speech | C05d | NEXT_STEP | deposit | speech | Next dada malpodu panle | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.055 | 1.19 s |
| speech | C06a | RESUME_WORKFLOW | withdraw | typed fallback after ASR refusal | — | ಅವು ಎರ್ನ ರಿಕ್ವೆಸ್ಟ್‌ನ್ ಕಂಟಿನ್ಯೂ ಮಲ್ಪುವೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.057 | 0.94 s |
| speech | C06b | RESUME_WORKFLOW | deposit | speech | Olpa unthayar alpa d continue malpule | ಅವು ಎರ್ನ ರಿಕ್ವೆಸ್ಟ್‌ನ್ ಕಂಟಿನ್ಯೂ ಮಲ್ಪುವೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.046 | 1.39 s |
| typed | C01a | REPEAT_STEP | deposit | typed | — | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.094 | 0.01 s |
| typed | C01b | REPEAT_STEP | withdraw | typed | — | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.076 | 0.0 s |
| typed | C01c | REPEAT_STEP | deposit | typed | — | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.089 | 0.01 s |
| typed | C01d | REPEAT_STEP | withdraw | typed | — | ಸರಿ ಯಾನ್ ಕುಡ ಮೆಲ್ಲ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.119 | 0.01 s |
| typed | C02a | PAUSE_WORKFLOW | deposit | typed | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.131 | 0.01 s |
| typed | C02b | PAUSE_WORKFLOW | withdraw | typed | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.102 | 0.0 s |
| typed | C02c | PAUSE_WORKFLOW | deposit | typed | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.089 | 0.01 s |
| typed | C02d | PAUSE_WORKFLOW | withdraw | typed | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.077 | 0.01 s |
| typed | C02e | PAUSE_WORKFLOW | deposit | typed | — | ಓಕೆ ... ಎರ್ ಅರಮ್ಸೆ ಮಲ್ಪುಲೆ ... ಯಾನ್ ಎರ್ ಪಂಪಿನ ಮುಟ ಉಂತುವೆ .. | suspended/1 | 200 | 0.089 | 0.01 s |
| typed | C03a | STOP_REQUEST | withdraw | typed | — | ಓಕೆ ... ನನ ಒಇಕ್ ಅಂಡಲ ಹೆಲ್ಪ್ ಬೊಡಂಡ ಯೆಂಕ್ ಪನ್ಲೆ ... ಥ್ಯಾಂಕ್ ಯೂ. Say stop again to end the conversation. | cancelled/1 | 200 | 0.083 | 0.0 s |
| typed | C03b | STOP_REQUEST | deposit | typed | — | ಓಕೆ ... ನನ ಒಇಕ್ ಅಂಡಲ ಹೆಲ್ಪ್ ಬೊಡಂಡ ಯೆಂಕ್ ಪನ್ಲೆ ... ಥ್ಯಾಂಕ್ ಯೂ. Say stop again to end the conversation. | cancelled/1 | 200 | 0.064 | 0.01 s |
| typed | C03c | STOP_REQUEST | withdraw | typed | — | ಓಕೆ ... ನನ ಒಇಕ್ ಅಂಡಲ ಹೆಲ್ಪ್ ಬೊಡಂಡ ಯೆಂಕ್ ಪನ್ಲೆ ... ಥ್ಯಾಂಕ್ ಯೂ. Say stop again to end the conversation. | cancelled/1 | 200 | 0.064 | 0.01 s |
| typed | C04a | CLARIFY_CURRENT_STEP | deposit | typed | — | ತೊಂಡ್ರೆ ಎಜ್ಜಿ ಯಾನ್ ಎರೆಗ್ ಕುಡ ಪಂಪೆ.. If anything on this step is unclear, the bank staff can also help you. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.144 | 0.01 s |
| typed | C04b | CLARIFY_CURRENT_STEP | withdraw | typed | — | ತೊಂಡ್ರೆ ಎಜ್ಜಿ ಯಾನ್ ಎರೆಗ್ ಕುಡ ಪಂಪೆ.. If anything on this step is unclear, the bank staff can also help you. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.08 | 0.01 s |
| typed | C04c | CLARIFY_CURRENT_STEP | deposit | typed | — | ತೊಂಡ್ರೆ ಎಜ್ಜಿ ಯಾನ್ ಎರೆಗ್ ಕುಡ ಪಂಪೆ.. If anything on this step is unclear, the bank staff can also help you. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.083 | 0.01 s |
| typed | C05a | NEXT_STEP | withdraw | typed | — | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.092 | 0.0 s |
| typed | C05b | NEXT_STEP | deposit | typed | — | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.071 | 0.0 s |
| typed | C05c | NEXT_STEP | withdraw | typed | — | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.067 | 0.01 s |
| typed | C05d | NEXT_STEP | deposit | typed | — | ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.056 | 0.01 s |
| typed | C06a | RESUME_WORKFLOW | withdraw | typed | — | ಅವು ಎರ್ನ ರಿಕ್ವೆಸ್ಟ್‌ನ್ ಕಂಟಿನ್ಯೂ ಮಲ್ಪುವೆ. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.057 | 0.0 s |
| typed | C06b | RESUME_WORKFLOW | deposit | typed | — | ಅವು ಎರ್ನ ರಿಕ್ವೆಸ್ಟ್‌ನ್ ಕಂಟಿನ್ಯೂ ಮಲ್ಪುವೆ. ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | 0.046 | 0.01 s |
| typed | C04t1 | CLARIFY_CURRENT_STEP | withdraw | typed | — | ತೊಂಡ್ರೆ ಎಜ್ಜಿ ಯಾನ್ ಎರೆಗ್ ಕುಡ ಪಂಪೆ.. If anything on this step is unclear, the bank staff can also help you. ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ. | active/1 | 200 | None | 0.0 s |

## Checks

- PASS speech C01a 'Kuda panoli ya' (deposit) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01a: ASR transcript is a verified control phrase of the same group
- PASS   C01a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.094 < 0.5)
- PASS speech C01b 'Aven kuda panle' (withdraw) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.076 < 0.5)
- PASS speech C01c 'Yenk er panni kendhiji sari' (deposit) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01c: ASR transcript is a verified control phrase of the same group
- PASS   C01c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.089 < 0.5)
- PASS speech C01d 'Churu mella panle' (withdraw) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01d: ASR transcript is a verified control phrase of the same group
- PASS   C01d: reply newly synthesized (MP3, not a dataset recording, xcorr 0.119 < 0.5)
- PASS speech C02a 'Churu wait malpule' (deposit) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.131 < 0.5)
- PASS speech C02b 'Churu porth unthule' (withdraw) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.101 < 0.5)
- PASS speech C02c 'Yenk churu check malpere undu ..er churu porth wait malpule' (deposit) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.089 < 0.5)
- PASS speech C02d 'Yaan panpina muta continue malporchi' (withdraw) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02d: ASR transcript is a verified control phrase of the same group
- PASS   C02d: reply newly synthesized (MP3, not a dataset recording, xcorr 0.077 < 0.5)
- PASS speech C02e 'Yaan panpina muta unthule' (deposit) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02e: ASR transcript is a verified control phrase of the same group
- PASS   C02e: reply newly synthesized (MP3, not a dataset recording, xcorr 0.089 < 0.5)
- PASS speech C03a 'Eth aav .' (withdraw) -> STOP_REQUEST: correct engine action and Tulu acknowledgement
- PASS   C03a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.083 < 0.5)
- PASS speech C03b 'Nana explain malpodu pandh ejji' (deposit) -> STOP_REQUEST: correct engine action and Tulu acknowledgement
- PASS   C03b: ASR transcript is a verified control phrase of the same group
- PASS   C03b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.064 < 0.5)
- PASS speech C03c 'Yenk nana dada help borchi or thank u eth yaav information' (withdraw) -> STOP_REQUEST: correct engine action and Tulu acknowledgement
- PASS   C03c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.064 < 0.5)
- PASS speech C04a 'Yenk artha ayiji' (deposit) -> CLARIFY_CURRENT_STEP: correct engine action and Tulu acknowledgement
- PASS   C04a: ASR transcript is a verified control phrase of the same group
- PASS   C04a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.144 < 0.5)
- PASS speech C04b 'Kuda explain malpoli ya ..' (withdraw) -> CLARIFY_CURRENT_STEP: correct engine action and Tulu acknowledgement
- PASS   C04b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.081 < 0.5)
- PASS speech C04c 'Ancha panda dada' (deposit) -> CLARIFY_CURRENT_STEP: correct engine action and Tulu acknowledgement
- PASS   C04c: ASR transcript is a verified control phrase of the same group
- PASS   C04c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.083 < 0.5)
- PASS speech C05a 'Next dada' (withdraw) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05a: ASR transcript is a verified control phrase of the same group
- PASS   C05a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.092 < 0.5)
- PASS speech C05b 'Undu ayii bokka dada' (deposit) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05b: ASR transcript is a verified control phrase of the same group
- PASS   C05b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.071 < 0.5)
- PASS speech C05c 'Next panle' (withdraw) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05c: ASR transcript is a verified control phrase of the same group
- PASS   C05c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.068 < 0.5)
- PASS speech C05d 'Next dada malpodu panle' (deposit) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05d: ASR transcript is a verified control phrase of the same group
- PASS   C05d: reply newly synthesized (MP3, not a dataset recording, xcorr 0.055 < 0.5)
- PASS speech C06a 'Continue malpule' (withdraw) -> RESUME_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C06a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.057 < 0.5)
- PASS speech C06b 'Olpa unthayar alpa d continue malpule' (deposit) -> RESUME_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C06b: ASR transcript is a verified control phrase of the same group
- PASS   C06b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.046 < 0.5)
- PASS typed C01a 'Kuda panoli ya' (deposit) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.094 < 0.5)
- PASS typed C01b 'Aven kuda panle' (withdraw) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.076 < 0.5)
- PASS typed C01c 'Yenk er panni kendhiji sari' (deposit) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.089 < 0.5)
- PASS typed C01d 'Churu mella panle' (withdraw) -> REPEAT_STEP: correct engine action and Tulu acknowledgement
- PASS   C01d: reply newly synthesized (MP3, not a dataset recording, xcorr 0.119 < 0.5)
- PASS typed C02a 'Churu wait malpule' (deposit) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.131 < 0.5)
- PASS typed C02b 'Churu porth unthule' (withdraw) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.102 < 0.5)
- PASS typed C02c 'Yenk churu check malpere undu ..er churu porth wait malpule' (deposit) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.089 < 0.5)
- PASS typed C02d 'Yaan panpina muta continue malporchi' (withdraw) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02d: reply newly synthesized (MP3, not a dataset recording, xcorr 0.077 < 0.5)
- PASS typed C02e 'Yaan panpina muta unthule' (deposit) -> PAUSE_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C02e: reply newly synthesized (MP3, not a dataset recording, xcorr 0.089 < 0.5)
- PASS typed C03a 'Eth aav .' (withdraw) -> STOP_REQUEST: correct engine action and Tulu acknowledgement
- PASS   C03a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.083 < 0.5)
- PASS typed C03b 'Nana explain malpodu pandh ejji' (deposit) -> STOP_REQUEST: correct engine action and Tulu acknowledgement
- PASS   C03b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.064 < 0.5)
- PASS typed C03c 'Yenk nana dada help borchi or thank u eth yaav information' (withdraw) -> STOP_REQUEST: correct engine action and Tulu acknowledgement
- PASS   C03c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.064 < 0.5)
- PASS typed C04a 'Yenk artha ayiji' (deposit) -> CLARIFY_CURRENT_STEP: correct engine action and Tulu acknowledgement
- PASS   C04a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.144 < 0.5)
- PASS typed C04b 'Kuda explain malpoli ya ..' (withdraw) -> CLARIFY_CURRENT_STEP: correct engine action and Tulu acknowledgement
- PASS   C04b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.080 < 0.5)
- PASS typed C04c 'Ancha panda dada' (deposit) -> CLARIFY_CURRENT_STEP: correct engine action and Tulu acknowledgement
- PASS   C04c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.083 < 0.5)
- PASS typed C05a 'Next dada' (withdraw) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.092 < 0.5)
- PASS typed C05b 'Undu ayii bokka dada' (deposit) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.071 < 0.5)
- PASS typed C05c 'Next panle' (withdraw) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05c: reply newly synthesized (MP3, not a dataset recording, xcorr 0.067 < 0.5)
- PASS typed C05d 'Next dada malpodu panle' (deposit) -> NEXT_STEP: correct engine action and Tulu acknowledgement
- PASS   C05d: reply newly synthesized (MP3, not a dataset recording, xcorr 0.056 < 0.5)
- PASS typed C06a 'Continue malpule' (withdraw) -> RESUME_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C06a: reply newly synthesized (MP3, not a dataset recording, xcorr 0.057 < 0.5)
- PASS typed C06b 'Olpa unthayar alpa d continue malpule' (deposit) -> RESUME_WORKFLOW: correct engine action and Tulu acknowledgement
- PASS   C06b: reply newly synthesized (MP3, not a dataset recording, xcorr 0.046 < 0.5)
- PASS typed C04t1 'yank gothuji' (withdraw) -> CLARIFY_CURRENT_STEP: correct engine action and Tulu acknowledgement
- PASS   C04t1: reply newly synthesized (MP3, not a dataset recording, xcorr 0.000 < 0.5)
- PASS deposit paused at step 2, 'Next panle' -> C05 reply + step 2 (not step 3), workflow resumed
- PASS withdrawal paused at step 3, C06 continue -> C06 reply + step 3, resumed
- PASS C05 while active at step 3 -> C05 reply + step 3 (next never skips an unfinished step)
- PASS C01 repeat at step 3 -> C01 reply + step 3
- PASS 'Next dada' with nothing active -> engine's own message, no contradictory Tulu reply
- PASS 'Continue malpule' with nothing active -> engine's own message, no contradictory Tulu reply
- PASS 'Kuda panoli ya' with nothing active -> engine's own message, no contradictory Tulu reply
- PASS C02d with no workflow: no workflow started (never read as a service or as resume)
- PASS repeat with nothing active: no contradictory acknowledgement
- PASS near-miss Tulu -> 'please say it again, or type it' (clarify), nothing started
- PASS no LLM call was made by any control or start turn
