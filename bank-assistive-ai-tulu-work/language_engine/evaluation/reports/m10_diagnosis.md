# M10 diagnosis: where the M9 routing failures come from

Investigation only. No production code, model, example, threshold, rule, fixture or
baseline was changed. Generated data: `m10_diagnosis.json` (every clip, both
transcripts, detector internals), `m10_annotation_review.csv` (review sheet).
Tool: `evaluation/routing_diagnosis.py` (evaluation-only, offline, no LLM).

**The assistant-scope labels used below were proposed by the tooling from the
annotation notes. No human has reviewed them.** 34 of 200 are marked for review.

## Answer

**Option 5, more than one cause, but very unevenly.** On the reference transcript,
96 of 126 scored banking clips are routed wrongly. Of those:

| Primary cause | clips (all labels) | clips (trusted labels only) |
|---|---|---|
| A workflow starts though the sentence names no service (over-permissive start rule, plus no anchor for unsupported banking operations) | 92 | 85 |
| A service word inside an out-of-scope request ("loan" in loan-repayment questions, "balance" in a transfer) | 2 | 1 |
| Embeddings picked the wrong service, nothing named | 2 | 0 |
| ASR transcription error | 0 (see the comparison below: ASR adds 3, removes 5) | |

- **ASR errors are a minor cause:** 3 ASR-induced errors and 5 fixed by ASR across 200 clips.
- **Annotations:** the labels were not wrong, but M9 mapped them to the five services incorrectly for 11 clips. They were also written for a payments study, so 34 need domain review.
- **The intent model** cannot separate services in Kannada at all. It also has no "banking, but not something I do" anchor, so out-of-scope banking requests beat the anchors that do exist.
- **The routing rule** turns that weakness into a started workflow, because nothing requires the sentence to name the service.

## 1. Production routing path (traced, unchanged)

`service/engine.py` and `app/pipeline/voice_pipeline.py` share `VoiceAssistantPipeline._respond`:

1. **`normalize_turn(raw).routing`**: spelling normalisation, loanwords rewritten in English (ಬ್ಯಾಲೆನ್ಸ್ → balance), misheard-term repairs. **This routing text is what the embedding model sees as well as the keyword lists.**
2. **`detect_control`** (deterministic control tier): pause, repeat and similar. A match here ends the routing.
3. **Workflow active?** If so, the turn goes to `generate_response` and no new intent is detected.
4. **`answer_general_question`**: if `looks_like_a_question` or `looks_like_a_control_utterance` matches, the LLM classifies the turn. If the LLM says it's a question, it is answered; otherwise it falls through to step 5. *Offline the LLM is not called: these turns are "LLM-gated" and are reported, never scored.*
5. **`IntentDetector.detect_intent`**: cosine similarity against service examples and non-banking anchors.
   - **Lexical narrowing (M4):** when the sentence names services, the choice is made only among them.
   - **When nothing is named, the choice is all five services.**
   - **Margin test:** the best service must beat the best anchor by `BANKING_MARGIN` = 0.05.
6. **Abstention gate:** if it isn't a banking intent, `handle_non_banking_request(category)` replies and nothing starts.
7. **Refusal gate (M3):** any negation means nothing starts.
8. **`start_workflow(intent)`:** only deposit, withdraw and loan have workflow definitions. Balance and open-account reply "no guided procedure yet" and change no state.

**Where a workflow can start without sufficient evidence:** step 5 when no service word is present. The service then comes from embeddings alone, and the only check is the anchor margin. The anchors are knowledge questions, small talk, control words and *unsafe* requests ("rob the bank"). None of them is a legitimate banking operation the assistant does not offer, such as a transfer, UPI, bill payment, wallet top-up, card settings or insurance. So such requests beat every anchor.

**Where ambiguity is preserved:** step 5's `AMBIGUOUS_SERVICE` exists only for a sentence that names a service the embeddings don't prefer. A sentence that names *no* service is never treated as ambiguous.

## 2. Label validation

| Proposed class | clips | of which marked for review |
|---|---|---|
| valid service request | 19 | 14 |
| out of scope | 169 | 8 |
| ambiguous: should clarify | 11 | 11 |
| cannot be determined | 1 | 1 |

M9's mapping disagrees with the proposed assistant label on 11 clips:
- **`ivb_kn_069` "ನಾನು ಶಿಕ್ಷಣ ಸಾಲಕ್ಕೆ ಅಪ್ಲೈ ಮಾಡಬೇಕು":** an education loan application. The schema files loans under `other`, so M9 scored it as out of scope.
- **All 7 `deposit` clips are wallet top-ups from the customer's own bank account.** The assistant's deposit is a branch cash-deposit slip. The annotation's own rule 2 says this is the call a reviewer may flip.
- **Both `withdrawal` clips (`kn_035`, `hi_040`) are "what is the maximum I can withdraw?"** These are capability questions, which should be answered, not start a workflow.
- **`hi_042`** asks about a *wallet* balance.

**Also for review:**
- 8 loan-*repayment* questions.
- 10 "is there enough for X" balance questions.
- 4 multi-request clips.
- 1 complaint ("app doesn't show my balance").

Every row is in `m10_annotation_review.csv`, with the original text, annotation, M9 label, proposed label, predictions on both transcripts, the reason, and blank reviewer columns.

## 3. Reference vs ASR routing (200 banking clips)

| Effect | all | trusted labels |
|---|---|---|
| wrong on both, same decision | 85 | 77 |
| LLM-gated on either side (not scored) | 74 | 56 |
| correct on both | 27 | 22 |
| wrong on both, different wrong decision | 6 | 5 |
| ASR fixed an error | 5 | 4 |
| **ASR introduced an error** | **3** | **2** |

The 3 ASR-induced errors:

| Clip | Reference → ASR | Effect | Cause |
|---|---|---|---|
| `kn_042` | ಖಾತೇಲಿ → ಖಾತೆಯಲ್ಲಿ | balance → deposit | Kannada service scores are within 0.04, so a spelling variant reorders them. The real cause is model separation. |
| `hi_016` | केरला → केरल | balance → `AMBIGUOUS_SERVICE` | Margin went from 0.056 to 0.048, just under 0.05. "बैलेंस" is named. Without M5's loanword rewrite (बैलेंस → balance) the margin stays above 0.05: the English word inside a Hindi sentence lowers the embedding score. |
| `hi_090` | (name spelling) | no-start → deposit | A QR-sharing request crossing the margin by 0.017. Same no-evidence start. |

The 5 "fixed by ASR" are the same instability in the other direction. None of the 8 is a misrecognised banking word: banking-term recall was 100% on DEV in M9.

- **General clips (400, no labels):** ASR changed the decision on 71. 30 were no-start → a different no-start, and 14 involve the refusal gate flipping (negation suffixes misheard). These can't be scored without labels.
- **Text forms (M9 held-out):** 12 failures.
  - 6 starts on a sentence naming no service ("ಹಣ", "मुझे तीन हज़ार रुपये", "ಅಕೌಂಟ್ ವಿಷಯ ಒಂದಿದೆ"): the same no-evidence rule.
  - 2 refusal-gate false positives ("ATM not working, need to withdraw cash").
  - 3 control misses: 2 fillers before "repeat", and "रिपीट कीजिए" missing from the phrase table.
  - 1 English number words not parsed by M1.

## 4. Model vs rule evidence

**Model separation (reference transcripts, medians):**

| | best service score | gap to 2nd service | best anchor | margin |
|---|---|---|---|---|
| kn valid | 0.936 | 0.014 | 0.778 | 0.170 |
| kn out of scope | 0.927 | 0.011 | 0.716 | **0.208** |
| hi valid | 0.675 | 0.040 | 0.575 | 0.092 |
| hi out of scope | 0.538 | 0.028 | 0.479 | 0.058 |

- **Kannada:** every sentence scores about 0.93 against every service, and out-of-scope sentences clear the anchor margin by *more* than real requests do. No threshold can separate them, and thresholds were not changed. The 3.2B-12 note that Kannada similarity is driven by the sentence frame is confirmed on real speech.
- **The expected service ranks first on only 9 of 19 valid clips,** and 4 of 19 name it with a keyword.
- **Out-of-scope starts by service:** withdraw 81, balance 25, deposit 11, loan 9, open-account 4. Withdraw acts as the default for "send money" sentences.
- **The anchor beaten on 121 of 130 out-of-scope starts is `KNOWLEDGE_QUESTION`.** Unsupported banking operations have no anchor of their own.
  - Anchor examples by script: 31 Latin, 15 Kannada, 14 Hindi.
  - Service examples by script: 52 Latin, 48 Kannada, 35 Hindi.
  - `UNSUPPORTED` has 7 examples, all of them unsafe requests.
- **101 out-of-scope clips would reach a real workflow** (deposit, withdraw or loan), not the "no guided procedure" reply.

**Rule behaviour:**
- **The start rule:** 118 of 130 out-of-scope starts have no service word. Requiring a named service (in-memory counterfactual, nothing changed) would affect these:
  - Out-of-scope clips correct: 21 → 106 of 108.
  - Clarify clips correct: 1 → 7 of 7.
  - Valid clips correct: 8 → 4 of 10.
  - 11 currently-correct requests across the M0–M5 fixture sets would stop starting, e.g. "ನನ್ನ ಖಾತೆಯಲ್ಲಿ ಎಷ್ಟು ಹಣವಿದೆ", "खाते में पाँच सौ रुपये डालने हैं", "put some money into my account", "I want to take out two thousand rupees".
  - The rule is the right lever, but only once the evidence vocabulary covers how people phrase balance checks, deposits and withdrawals without the service noun.
- **Normalisation:** it changed the routing text of 20 reference clips and the detector's decision on 7.
  - 6 of those are flips between two wrong answers (balance ↔ withdraw on Kannada clips with a 0.01 score gap).
  - 1 is `hi_016` above. Feeding English-canonicalised text to a multilingual embedding is a small, real side effect. It is not a primary cause.
- **Refusal gate:** false positives where the negation belongs to something else (the ATM form, `kn_019`), plus 14 general-set flips under ASR. Secondary.
- **LLM gate:** 74 of 200 banking clips depend on an LLM decision that wasn't measured. If the LLM hands them back, the detector would start a service on 43 out-of-scope and 3 clarify clips.

## 5. Missing evidence and confidence

| Conclusion | Confidence | What would raise it |
|---|---|---|
| ASR is a minor cause on this audio | High for these 200 clips; **low for real customers** | The clips are clean, read and from the training split. It needs held-out, noisy, spontaneous branch audio, plus English and Latin code-switching audio (none on disk). |
| Out-of-scope requests start workflows with no service named | High (deterministic, reproduced per clip) | — |
| Kannada model separation is essentially absent | High | — |
| Labels are mostly sound but mis-mapped to the five services | Medium | A human domain review of the 34 rows in the CSV |
| Requiring evidence needs more service phrasing first | Medium | Measured on the existing fixtures and M9 clips only. A fresh, unseen dev set of paraphrased requests is needed before any change. |
| LLM-gated turns | **Unknown** | LLM decisions are not recorded. A recorded, offline replay of LLM outputs would be needed. |
| Effect of a new "unsupported banking" anchor | Unknown | Not tested: it would be a new example set, which this stage excludes. |

## 6. Minimal fix plan (for approval; nothing implemented)

Ranked by impact against risk:

1. **Don't start a workflow on embeddings alone.** When no service word is present, return `AMBIGUOUS_SERVICE` (ask which service) instead of starting.
   - **Impact:** the largest. It covers 118 of 130 out-of-scope starts and all 6 guessed-service text forms.
   - **Risk:** high recall loss unless paired with fix 2 (11 fixture requests, 4 of 10 valid clips).
   - **Prerequisite:** a fresh dev fixture of unnamed-service paraphrases, written before the change.
2. **Extend service evidence with service phrasing, not single nouns.** For example "how much money is in my account" (ಎಷ್ಟು ಹಣ ಇದೆ, कितने पैसे हैं, शेष, बाकी), "put money into the account" (ಹಣ ಹಾಕು, पैसे डालने), "take out" with a money word.
   - **Impact:** it recovers what fix 1 loses.
   - **Risk:** medium, because keyword lists over-match. The same frame-collision tests as M4 apply.
3. **Add a "banking operation we don't offer" anchor set** (transfer, UPI, bill payment, wallet, card settings, insurance, rewards) in kn, hi and en, so the abstention gate can say *"I can't do transfers here"*.
   - **Impact:** high on its own for out-of-scope requests, and needs no keyword change.
   - **Risk:** medium. Its examples sit near withdraw and deposit, so it needs the 3.2B-12 margin re-measurement.
   - This adds examples; it doesn't add a model.
4. **Loan-repayment questions:** "loan" is evidence for *apply for loan* only when it's not a repayment or payment question. Impact is small (8 clips); risk is low.
5. **Small, independent rule fixes:**
   - Allow a filler before a control word.
   - Add "रिपीट कीजिए".
   - Scope the refusal gate to negations of the service verb ("ATM ಕೆಲಸ ಮಾಡ್ತಿಲ್ಲ").
   - Parse English number words in amounts.
   - Impact is low but these are user-visible; risk is low.
6. **Evaluation fixes (no production change):**
   - Map labels to the five services with human review of the CSV.
   - Score balance and open-account "starts" as replies, since no workflow exists for them.
   - Record LLM decisions for replay.

Not recommended:
- **Raising `BANKING_MARGIN`:** in Kannada the out-of-scope margin is above the valid one, and it is outside the allowed changes anyway.
- **Removing loanword canonicalisation from the embedding input:** one borderline clip doesn't justify it. It could be revisited as a measured experiment within fix 1.

## 7. Nothing changed

- **Production code:** no file under `app/` or `service/` was modified in this stage.
- **Evaluation:** no fixture, M0–M9 baseline report or M9 harness file was modified.
- **No live services:** no LLM, network, database or service was used.
- **New files:** `evaluation/routing_diagnosis.py`, `evaluation/reports/m10_diagnosis.{md,json}`, `evaluation/reports/m10_annotation_review.csv`.
