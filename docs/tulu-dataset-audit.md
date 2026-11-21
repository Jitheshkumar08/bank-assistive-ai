# Tulu Dataset & TTS Feasibility Audit (Phase 1)

Date: 2026-11-17. Scope: `deposit conversation/` and `language_engine/` in `bank-assistive-ai-tulu-work/`.
No original recording or annotation was modified. All analysis ran on decoded copies in a temp folder.

## 1. Inventory

| Item | Value |
|---|---|
| Audio files | 16 (13 WAV PCM16, 3 AAC/M4A named `D01a/b/c_CUSTOMER.wav.m4a`, though the document lists them as `.wav`) |
| Sample rate / channels | 48 kHz, stereo with identical L/R channels (dual-mono) |
| Total duration | 87.7 s (≈1.5 min) |
| Assistant recordings | 4 (`D01–D04_ASSISTANT.wav`), 24.8 s file time, **≈15.0 s actual speech** |
| Customer recordings | 12 (`D01a`…`D04c`), 62.9 s file time |
| Speakers | Probably 1 adult male voice for both roles (median F0 102–117 Hz in all 16 files). This was not checked with a speaker-embedding model. |
| Transcripts | 16/16 in `Tulu_Cash_Deposit_Dataset_Workflow_Aligned_Final.docx`: Romanized Tulu, an English meaning and a filename for each, mapped 1:1 |
| Domain / intent coverage | **Deposit only** (1 of 7 required banking intents). Each line maps to one of the 4 `deposit.json` steps. |
| Voice-use consent | **Not documented anywhere in the workspace** |

Assistant utterances (the only possible TTS training material):

| File | Romanized Tulu (authoritative) | Speech |
|---|---|---|
| D01_ASSISTANT | Okay, first er cash deposit dh slip dethonle. | 4.38 s |
| D02_ASSISTANT | Ait erna account number barele. | 2.62 s |
| D03_ASSISTANT | Bokka eth amount deppere undu aven barele. | 3.88 s |
| D04_ASSISTANT | Slip Boka amount n cash counter d korle. | 4.10 s |

Together these are about 27 words and about 24 distinct tokens, many of them English loanwords (cash, deposit, slip, account, number, amount, counter).

## 2. Recording quality (measured)

- No clipping. Peaks range from −0.1 to −9.4 dBFS.
- Loudness varies: assistant RMS runs from −21.5 to −29.7 dBFS (an 8 dB spread).
- **Hard noise gate.** Between 24% and 61% of the samples in every file are exact digital zero. Pauses are absolute silence, and the gate edges are abrupt.
- **Processed and band-limited.** Energy above 8 kHz sits 55–76 dB below the total (natural speech is usually around −25 to −35 dB). This looks like phone-app noise suppression. Fricatives and sibilants are attenuated.
- About 1.5 s of leading silence and up to 2.2 s of trailing silence. Each clip has 2 speech chunks.

## 3. Transcript alignment

- The filenames map one-to-one to transcript rows.
- Acoustic check: zero-shot Whisper-small (`language="kn"`) returned **empty output for D01, D02 and D04_ASSISTANT** and for D01a, and returned "painters" for D03a. For D03_ASSISTANT it returned Devanagari "वुक्का एद एमाउंप देप्परे उंदू आवेंद बरेली". That reading matches *Bokka eth amount deppere undu aven barele* sound for sound, so D03 is confirmed aligned. The other files could not be checked acoustically.
- Annotation inconsistencies to resolve with the annotator. **They have not been edited.**
  1. D04 assistant: the table says *"Slip Boka amount n cash counter d korle."*, but the notes give the confirmed wording as *"Slip Boka amount n korle."*.
  2. The same word is spelled *Bokka* (D03) and *Boka* (D04).
  3. The pronoun is spelled *Yank* / *Yan* / *Yaan*.
  4. A note says *"Yan deposit malpuna amount bareye?"* maps to D03, but the near-identical D04c is filed under D04.

## 4. Existing engine (relevant facts)

- TTS: `app/speech/tts.py` and `service/tts.py` use **Edge TTS (Microsoft cloud)** with voices for en, kn and hi only. There is no Tulu voice.
- ASR: Whisper and IndicConformer (kn/hi). Both deliberately refuse `tcy` (`indic_conformer_provider.NEVER_CLAIMED`, `WHISPER_LANGUAGES`). The earlier audit (`debugging/spike/phase_3_2b10_asr_candidate_audit.md`) found that only the gated SraVaani model covers Tulu, at 57.3% WER.
- Translation: `app/translation/translator.py` is a pass-through placeholder that already maps `tulu` to `tcy`.
- Workflows: only `deposit.json`, `withdraw.json` and `apply_for_loan.json` exist. **There are no balance-enquiry, account-opening, money-transfer or passbook workflows** in this copy.

## 5. Public model check (Hugging Face API, 2026-11-17)

- No `facebook/mms-tts-tcy`. `facebook/mms-1b-all` has no `tcy` adapter (HTTP 404). No Tulu speech model or dataset turned up in the search.
- Kannada-script TTS candidates exist: `ai4bharat/IndicF5` (voice-prompted / cloning), `ai4bharat/indic-parler-tts`, and `SYSPIN/vits_Kannada_*` / `multilingual-tts/VITS-OpenBible-Kannada` (VITS). Tulu text models in Kannada script (`goldfish-models/tcy_knda_*`) confirm that Tulu is commonly written in Kannada script.

## 6. Verdict: can the assistant recordings train a neural Tulu TTS voice?

**No.** Four utterances with about 15 s of speech are far below any trainable threshold:

| Approach | Typical minimum | We have |
|---|---|---|
| VITS / Piper from scratch | 10–20+ h | 0.004 h |
| Fine-tune a pretrained VITS/Piper checkpoint to a new language and speaker | ≥30–60 min of clean, aligned speech | 15 s |
| Train/eval split without leakage | Needs held-out sentences | 4 sentences |

Fine-tuning on these 4 clips would only memorise them, and the gating and band-limiting would be baked into the voice. It would not pronounce new sentences, so in effect it would become "prerecorded playback", which the requirements forbid.

**What the recordings can support:**
- A **speaker reference prompt** of 4–6 s for a zero-shot voice-cloning TTS such as IndicF5, if the speaker consents. The clip would need loudness normalisation and silence trimming, applied to a copy.
- A **pronunciation reference** for native-speaker evaluation of the generated audio.
- A **12-utterance ASR / intent evaluation set** for deposit. It is too small for training, and it is all the evaluation data that exists.

**Feasible, honest TTS architecture:** convert verified Romanized Tulu to Kannada-script Tulu (deterministic transliteration, checked by the native speaker), then generate fresh speech with a pretrained Kannada-script neural TTS. This is *cross-lingual synthesis of Tulu text with a Kannada-trained acoustic model*. It must be labelled that way and rated for intelligibility by a native speaker. It is not "Kannada speech labelled as Tulu", because the words are Tulu, but Tulu-specific vowels may be mispronounced.
