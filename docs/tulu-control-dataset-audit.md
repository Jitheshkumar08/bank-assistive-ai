# Tulu Control-Statements Dataset Audit

Date: 2026-11-17. Folder: `control_statement/`. Read-only audit: no recording or document was modified.
Measurements were taken on decoded copies in a temp folder.

## 1. Contents

| Item | Value |
|---|---|
| Document | `Tulu_Conversation_Control_Statements_C01-C04.docx` (file dated 13 Nov 2026, earlier than the recordings, 17 Nov) |
| Statements | **19: 15 customer, 4 assistant** (one shared assistant reply per group) |
| Recordings | 19, one per statement. Every statement has a recording; there are no text-only rows. |
| Format | WAV PCM **24-bit, mono, 48 kHz** (same as the withdrawal set) |
| File duration | 171.2 s total (7.6–12.2 s per file) |
| Actual speech (measured) | **≈36.0 s total: customer ≈25.3 s, assistant ≈10.7 s**. Customer phrases last 0.9–3.6 s each. |
| Levels | Many files peak at exactly −0.5 dBFS, consistent with peak normalisation (no clipping) |
| Gating | 30–56% digital-zero samples (noise-gated, as in the other sets) |
| Bandwidth | Energy above 8 kHz at −18 to −42 dB (natural) |
| Speaker | Median F0 195–250 Hz: probably the same speaker as the withdrawal set (199–229 Hz), different from deposit (102–117 Hz). Not verified with a speaker model. |
| Kannada-script forms | **None supplied** |
| Native-speaker verification | **Not stated.** The document says: "The English meanings are working glosses; retain the supplied Tulu wording for recording." |
| Voice-use consent | Not documented, so no cloning |

## 2. Statements (verbatim)

| Group (document heading) | ID | Romanized Tulu | English (working gloss) |
|---|---|---|---|
| **C01** Asking the assistant to repeat or speak slowly | C01a | Kuda panoli ya | Can you say that again? |
| | C01b | Aven kuda panle | Please say that once again. |
| | C01c | Yenk er panni kendhiji sari | I couldn't hear you properly. |
| | C01d | Churu mella panle | Please speak a little slowly. |
| | C01 (assistant) | Sari yaan kuda mella panpe. | Okay, I'll repeat it slowly. |
| **C02** Asking the assistant to wait or pause | C02a | Churu wait malpule | Please wait a little. |
| | C02b | Churu porth unthule | Wait for some time. |
| | C02c | Yenk churu check malpere undu ..er churu porth wait malpule | I need to check something; please wait a little. |
| | C02d | Yaan panpina muta continue malporchi | Please don't continue until I finish what I'm doing/saying. |
| | C02e | Yaan panpina muta unthule | Please wait until I finish. |
| | C02 (assistant) | Okay ... Er aramse malpule ... yaan er panpina muta unthuve .. | Okay, take your time. I'll wait until you finish. |
| **C03** Stopping the conversation or declining further help | C03a | Eth aav . | That's enough. |
| | C03b | Nana explain malpodu pandh ejji | I don't need any further explanation. |
| | C03c | Yenk nana dada help borchi or thank u eth yaav information | I don't need any more help, thank you. That's all the information I need. |
| | C03 (assistant) | Okay ... nana oik andala help bodanda yenk panle ... thank you. | Okay, let me know if you need any other help. Thank you. |
| **C04** Asking for clarification or another explanation | C04a | Yenk artha ayiji | I didn't understand. |
| | C04b | Kuda explain malpoli ya .. | Can you explain it again? |
| | C04c | Ancha panda dada | What does that mean? |
| | C04 (assistant) | Thondre ejji yaan ereg kuda panpe.. | No problem, I'll explain it again to you. |

No meaning is missing: every row has a gloss. The glosses are explicitly *working* glosses.

## 3. Issues, preserved and not corrected

| # | Issue | Treatment |
|---|---|---|
| 1 | Native-speaker verification not stated; glosses are "working glosses" | Marked `verification: not stated` on every row; glosses stored exactly as supplied |
| 2 | Filenames: document lists `C01a_CUSTOMER.wav`; delivered `c01a_customer.wav.wav` (lower case, doubled extension); `C02c_customer.wav.wav` and `C02e_Customer.wav.wav` use mixed case | Matched case-insensitively; files left as delivered |
| 3 | **C03 group heading names two different actions**: "Stopping the conversation" (would end the session) or "declining further help" (would not). The assistant reply ("let me know if you need any other help") suggests the session continues. | Mapped to the engine's non-destructive closing acknowledgement (`thanks`), never to exit or cancel. **Needs native and team confirmation.** |
| 4 | C03c "…help borchi **or** thank u eth yaav information": "or" (English?) and the texting form "thank u"; the gloss adds "That's all the information I need" | Kept verbatim |
| 5 | C03 assistant "nana **oik** andala": "oik" is unclear (possible typo) | Kept verbatim; flagged for review, since it will be spoken by TTS |
| 6 | C03a "Eth aav **.**": stray space before the full stop; very short (0.86 s of speech) | Kept; short phrases are hard for matching and ASR |
| 7 | **C02d contains the English word "continue"** ("…continue malporchi", *don't continue*). Read as English, "continue" is the engine's RESUME command, the opposite meaning. | Matched as a whole to PAUSE; tests assert it never resumes |
| 8 | C01d / C01 assistant ask for and promise **slower** speech | The engine has no slow-speech control; mapped to repeat. The current TTS does **not** slow down (known gap). |
| 9 | C02d gloss "what I'm doing/saying" gives alternatives | Kept verbatim |
| 10 | Spelling variants: "unthule"/"unthuve", "aav"/"yaav", "Yenk"/"Yaan"/"yaan", ellipses written ".." / "..." | Kept; matching keys fold only doubled letters and aspiration |
| 11 | No Kannada-script forms supplied | Stored `null`; any Kannada script used for speech is machine transliteration pending review |
| 12 | No phrases for NEXT, PREVIOUS or RESUME | Not implemented for Tulu (no data) |

## 4. Control intents supported by this dataset and by the engine

The engine's existing **deterministic** control tier (`app/dialogue/manager.py`, `classify_command`) runs **before** the
LLM and already implements `repeat`, `pause`, `resume`, `cancel`, `next`, `help`, `thanks`/acknowledgement and `session_exit`.
There is no "previous step" command.

| Canonical id | Dataset group | Engine action (existing) | Confidence in mapping |
|---|---|---|---|
| `REPEAT_STEP` | C01 (4 phrases) | `repeat`: restates the current instruction | Clear (heading + glosses) |
| `PAUSE_WORKFLOW` | C02 (5 phrases) | `pause` | Clear |
| `DECLINE_FURTHER_HELP` | C03 (3 phrases) | `thanks`: closing acknowledgement, non-destructive | **Uncertain** (heading names two actions) |
| `CLARIFY_CURRENT_STEP` | C04 (3 phrases) | `help`: explains the current field and restates the step | Clear |
| NEXT_STEP, PREVIOUS_STEP, RESUME_WORKFLOW | — | — | **No data; not implemented** |

## 5. Sufficiency

- **Matching:** sufficient for closed-set matching of these 15 phrases (deterministic engine actions, no workflow-destroying action).
- **Training:** not sufficient for any ASR or TTS training (≈36 s of speech), and none is attempted.
- **Recordings:** usable as an ASR evaluation set (short phrases, expected to be hard).
- **Assistant replies:** usable as verified-wording acknowledgements *pending native confirmation*, especially C03 ("oik").

---

## 6. Update 2026-11-19: groups C05 and C06 added

The same document (still named `…C01-C04.docx`) now holds **C01–C06**. A Word lock file was present when it was read, so it may still be being edited; the saved version was used.

| Group (document heading) | ID | Romanized Tulu | English (working gloss) |
|---|---|---|---|
| **C05** Asking what comes next | C05a | Next dada | What next? |
| | C05b | Undu ayii bokka dada | What comes after this? |
| | C05c | Next panle | Please tell me what's next. |
| | C05d | Next dada malpodu panle | Tell me what I should do next. |
| | C05 (assistant) | Avu next dada malpodu annd panpe. | I will say what to do next. |
| **C06** Asking the assistant to continue | C06a | Continue malpule | Please continue what you were saying. |
| | C06b | Olpa unthayar alpa d continue malpule | Please continue from where you stopped. |
| | C06 (assistant) | Avu erna request n continue malpuve. | Okay, I'll continue your request. |

**Recordings.**
- 8 new files, each named exactly as listed in the document.
- **16-bit stereo**, 48 kHz (C01–C04 are 24-bit mono).
- Speech: about 10.7 s customer, 5.7 s assistant.
- **Median F0 106–132 Hz.** This is consistent with the *deposit* speaker, not the C01–C04 speaker (195–250 Hz), so control now has two speakers (not verified with a speaker model).
- Same heavily processed profile as the deposit set (energy above 8 kHz at −54 to −73 dB).

**Totals now:**
- 27 statements: 21 customer, 6 assistant.
- About 52 s of speech.
- Verification is still **not stated**; the glosses are still "working glosses".

**Mapping.** Both groups map to existing deterministic engine actions.

| Canonical | Group | Engine action | Mapping |
|---|---|---|---|
| NEXT_STEP | C05 (4) | `next`. Resumes a paused workflow and **never skips an unfinished step**. | clear |
| RESUME_WORKFLOW | C06 (2) | `resume` | clear |

PREVIOUS_STEP still has no data, and the engine has no such command.

**New issue.** C06a "**Continue** malpule" (*please continue*) and C02d "…**continue** malporchi" (*don't continue*) share a word but have opposite meanings. Both are matched as whole phrases, and tests assert that C02d pauses and C06 resumes.

## 7. Situational assistant replies

Each group has one shared assistant reply, but what must follow it depends on the situation. Example: "Next panle" while deposit is paused at step 2 must give the C05 reply **and the step 2 instruction**. The composition follows each reply's English meaning (`CONTROL_REPLY_PLAN` in `app/tulu/data/dataset.py`, applied in `service/main.py`).

| Group | Reply meaning | Spoken reply = |
|---|---|---|
| C01 | "Okay, I'll repeat it slowly." | C01 + current step |
| C02 | "Okay, take your time. I'll wait until you finish." | C02 only (workflow paused) |
| C03 | "Okay, let me know if you need any other help." | C03 only (workflow unchanged) |
| C04 | "No problem, I'll explain it again to you." | C04 + engine explanation (English, no verified Tulu) + current step |
| C05 | "I will say what to do next." | C05 + current step |
| C06 | "Okay, I'll continue your request." | C06 + current step |

How it works:
- **"Current step"** is read from the conversation *after* the engine acted, and rendered in verified Tulu where one exists. Deposit step 4 stays English because its wording is disputed.
- **When nothing is active,** the engine's own message is kept and no Tulu reply is added, because a Tulu "I'll continue your request" would contradict it.

## 8. Update 2026-11-19: C03 decision

On the team's instruction, C03 is now `STOP_REQUEST`, mapped to the engine's existing `stop` (cancel). It is no longer the closing acknowledgement.

- The engine asks for confirmation first, so one C03 phrase never cancels on its own.
- Repeating C03 confirms; C06 "continue" keeps the request.
- **Native-speaker confirmation of this meaning is still required** (issue 3 in §3).
