# M9 ASR evaluation on real speech: m9_smoke

Production recogniser on the IndicVoices clips on disk. Scored with the Phase 3.2B-7 normalisation, unchanged (number words vs digits and native vs Latin script count as errors).

**Banking clips are from IndicVoices' train split, which IndicConformer was very likely trained on: those numbers are optimistic. General clips are from the validation split. There is no English audio and no Latin-script code-switching audio, so those categories are not measured here.**

| Set / split / category | clips | min | WER % | CER % | exact | loanwords (recall %) | banking terms (recall %) | amount vs gold: correct / wrong / lost / invented | amount vs reference (ASR effect) | intent: unchanged / wrong service / lost / invented / other | errors | fallbacks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| banking / dev / kn | 1 | 0.2 | 30.0 | 7.3 | 0 | 0 (–) | 1 (100.0) | 0/1 · 0 · 1 · 0 | – | 0 / 0 / 0 / 1 / 0 | 0 | 0 |
| banking / dev / kn-en | 1 | 0.3 | 15.8 | 5.4 | 0 | 7 (100.0) | 1 (100.0) | 1/1 · 0 · 0 · 0 | correct 1 | 1 / 0 / 0 / 0 / 0 | 0 | 0 |
| banking / dev / hi | 1 | 0.2 | 9.1 | 2.4 | 0 | 0 (–) | 0 (–) | 1/1 · 0 · 0 · 0 | correct 1 | 1 / 0 / 0 / 0 / 0 | 0 | 0 |
| banking / dev / hi-en | 1 | 0.4 | 23.4 | 9.9 | 0 | 2 (100.0) | 0 (–) | 1/1 · 0 · 0 · 0 | correct 1 | 1 / 0 / 0 / 0 / 0 | 0 | 0 |
| banking / dev / kn (all) | 2 | 0.5 | 20.7 | 6.1 | 0 | 7 (100.0) | 2 (100.0) | 1/2 · 0 · 1 · 0 | correct 1 | 1 / 0 / 0 / 1 / 0 | 0 | 0 |
| banking / dev / hi (all) | 2 | 0.6 | 18.8 | 7.5 | 0 | 2 (100.0) | 0 (–) | 2/2 · 0 · 0 · 0 | correct 2 | 2 / 0 / 0 / 0 / 0 | 0 | 0 |
| general / held-out / kn | 1 | 0.4 | 10.0 | 1.6 | 0 | 0 (–) | 0 (–) | 0/0 · 0 · 0 · 0 | – | 1 / 0 / 0 / 0 / 0 | 0 | 0 |
| general / held-out / kn-en | 1 | 0.4 | 8.8 | 4.0 | 0 | 1 (100.0) | 0 (–) | 1/1 · 0 · 0 · 0 | correct 1 | 1 / 0 / 0 / 0 / 0 | 0 | 0 |
| general / held-out / hi | 1 | 0.1 | 41.7 | 18.0 | 0 | 0 (–) | 0 (–) | 0/0 · 0 · 0 · 0 | – | 1 / 0 / 0 / 0 / 0 | 0 | 0 |
| general / held-out / hi-en | 1 | 0.3 | 6.2 | 2.9 | 0 | 3 (100.0) | 1 (100.0) | 0/0 · 0 · 0 · 0 | – | 1 / 0 / 0 / 0 / 0 | 0 | 0 |
| general / held-out / kn (all) | 2 | 0.8 | 9.1 | 3.2 | 0 | 1 (100.0) | 0 (–) | 1/1 · 0 · 0 · 0 | correct 1 | 2 / 0 / 0 / 0 / 0 | 0 | 0 |
| general / held-out / hi (all) | 2 | 0.4 | 15.9 | 7.7 | 0 | 3 (100.0) | 1 (100.0) | 0/0 · 0 · 0 · 0 | – | 2 / 0 / 0 / 0 / 0 | 0 | 0 |

## Clips where ASR changed the amount or the routing decision

| Clip | split | category | effect | reference | hypothesis |
|---|---|---|---|---|---|
| ivb_kn_002 | dev | kn | routing service_invented: llm_gate -> start/withdraw money | ಮೊಬಿಕ್ವಿಕ್ ಆ್ಯಪಿನಲ್ಲಿ ಮಾರುತಿ ಕಾಮತ್ ಅವರಿಗೆ ತಿಂಗಳಿಗೊಮ್ಮೆ ಅಟೋಮೆಟಿಕ್ ಆಗಿ ಕಳಿಸ್ತಿರೋ ಒಂದು ಸಾವಿರ  | ಮೊಬಿಕ್ವಿಕ್ ಆ್ಯಪ್ನಲ್ಲಿ ಮಾರುತಿ ಕಾಮತ್ ಅವರಿಗೆ ತಿಂಗಳಿಗೊಮ್ಮೆ ಆಟೋಮೆಟಿಕ್ಕಾಗಿ ಕಳಿಸ್ತಿರೋ ಒಂದು ಸಾವಿರ  |

## Limits

- No English audio and no recording with English in Latin script exist on disk: English and Latin-script code-switching are not measured from speech.
- 'Code-mixed' here means English words SPOKEN inside Kannada / Hindi and written in native script in the reference (LOANWORD_MARKERS). It is the only code-mixing the corpus contains.
- Banking clips come from the IndicVoices train split (likely in IndicConformer's training data): optimistic.
- IndicVoices clips are read prompts, mostly clean; branch-counter noise, accents and spontaneous speech are not represented.
- Downstream routing is compared reference-vs-hypothesis through the offline router; the LLM gate is not called, so LLM-gated turns count as unchanged when both sides are gated.
