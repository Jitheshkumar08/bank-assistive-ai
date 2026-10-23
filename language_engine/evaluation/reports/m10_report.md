# M10 report: routing safety

Text-only, offline evaluation (no LLM, network, database or audio). Nothing here is evidence
about speech recognition.

## Routing policy changes

A workflow now starts only when the unchanged margin test passes **and** the sentence
establishes a supported service. Otherwise:

| Situation | Before M10 | After M10 | Reply (existing, already translated) |
|---|---|---|---|
| Banking-looking, no service named or phrased | started the nearest service by embedding | `AMBIGUOUS_SERVICE` | "Okay. Let me know which banking service you'd like help with." |
| Unsupported operation (transfer, UPI, bills, wallets, cards, insurance, investments) | started the nearest service, or the knowledge answerer | `UNSUPPORTED_OPERATION` | "I can't help with that. I can help you deposit money, withdraw money, check your balance, apply for a loan or open an account. Which would you like?" |
| Unsupported and supported service in one sentence | started the supported one | `AMBIGUOUS_SERVICE` | which-service sentence |
| Question about a service (how, limits, documents, eligibility, interest, charges, procedure, rules, why, when) that reaches the detector | started the service | `KNOWLEDGE_QUESTION` | existing knowledge answerer |
| Any of the above, negated | refusal reply | refusal reply (preserved via `withheld_start`) | unchanged |

Recognising a service is broader than keywords: "how much money is in my account", "ಖಾತೆಗೆ ದುಡ್ಡು
ಹಾಕ್ಬೇಕು", "take some cash out", "मेरे खाते में अभी कितना पैसा बचा है". These are word
combinations, still with no training.

**Unchanged:**
- The embedding model, the examples and anchors, and `BANKING_MARGIN`.
- The scores and margin themselves.
- The control tier, the LLM gate, the refusal and negation logic.
- The workflows, ASR, TTS, backend and frontend.

## Files

- **Production:**
  - `app/intent/routing_safety.py` (new)
  - `app/intent/service_keywords.py`
  - `app/intent/detector.py`
  - `app/pipeline/voice_pipeline.py`
  - `app/dialogue/manager.py` (comments only)
- **Tests:**
  - `debugging/test_m10_routing.py` (new, 80 checks)
  - `debugging/test_m4_intent.py`: one assertion updated, see Regressions
- **Evaluation:**
  - `evaluation/m10_routing_eval.py` (new)
  - `evaluation/routing_diagnosis.py` (`--name`; mirrors the withheld refusal rule)
  - `evaluation/fixtures/m10_dev.json` (new)
  - `evaluation/fixtures/M10_LABEL_POLICY.md` (new)
  - `evaluation/README.md`
  - reports `m10_*`

## Results (before → after)

M10 dev set (settled rows; author-labelled):

| Metric | Before | After |
|---|---|---|
| correct intent | 41/52 | 46/52 |
| wrong service | 6 | 0 |
| false workflow starts | 24/42 | **0/42** |
| into a real (deposit/withdraw/loan) workflow | 20 | 0 |
| vague → asks which service | 0/13 | 9/13 (rest: no start, other reply) |
| unsupported → declined | 2/22 (15 started) | **22/22** |
| gated questions that would start if the LLM handed them back | 10/14 | 0/14 |

The 5 pending-policy rows went from 4/4 false starts to 0/4.

Held-out sets, via the M10 evaluator:

| Set | Correct intent | False starts | Notes |
|---|---|---|---|
| M0 | 53/57 → 53/57 | 0/1 → 0/1 | gated questions that would start if handed back: 20 → 6 |
| M3 | 12/12 → 12/12 | 0/19 → 0/19 | gated would start: 13 → 9 |
| M4 | 31/39 → 35/39 | 12/18 → **0/18** | wrong service 5 → 0; questions 3/10 → 10/10 |
| M5 | 21/26 → 23/26 | 7/14 → **0/14** | wrong service 2 → 0 |
| M7 | — | 5/6 → **0/6** | gated would start: 35 → 9 |

Same sets, M0 harness unchanged (severity):

| Set | Critical | Miss |
|---|---|---|
| M4 | 17 → 0 | 3 → 4 |
| M5 | 9 → 0 | 3 → 3 |
| M7 | 5 → 0 | 0 → 5 |
| M0 | 0 → 0 | 9 → 9 |
| M3 | 0 → 0 | 1 → 1 |

M9 real-speech banking clips (labels not human-verified; reference transcript):

| Metric | Before | After |
|---|---|---|
| out-of-scope requests that started a workflow | 87 | 0 |
| valid requests correct | 8/10 | 9/10 |
| ASR-induced routing errors | 3 | 1 |
| gated out-of-scope clips that would start if handed back | 43 | 1 |

## Regressions

1. **`svc-kn-403` (M4 held-out) "ನನ್ನ ಖಾತೆಯಲ್ಲಿರುವ ಹಣ ತಿಳಿಸಿ"** (tell me the money in my account): it went
   from starting a balance check to asking which service. It's a safe direction, but a lost correct answer. The
   "tell/show + account + money" family is not in the dev set, so fixing it now would be
   tuning against held-out data.
2. **M7 `kq-*-750` "who is a current account for?"** (5 rows): these went from starting a workflow (critical) to the
   which-service reply (miss). Nothing starts now, but the question isn't answered either.
3. **`debugging/test_m4_intent.py`**: one assertion said "ಖಾತೆಗೆ ಹಣ ಹಾಕಬೇಕು" names no service. Its
   comment's purpose ("not account opening") is kept and still asserted. The sentence is now a
   deposit, which is also how M0 `svc-kn-02` labels it.

## Still open

- **Refusal gate on problems that carry a request:** "ATM not working, need to withdraw" still
  answers as a refusal (3 dev rows). This is unchanged by design (objective 6); fixing it means scoping
  negation, which needs a separate decision.
- **Pre-existing gaps M10 doesn't touch:**
  - Controls: 4 dev control phrases are missed.
  - M1 amounts: English and romanised number words aren't parsed.
  - Margin: some valid requests fall below `BANKING_MARGIN` ("ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್ ಮಾಡೋದಿದೆ").
  - LLM gate: questions and balance enquiries that are LLM-gated depend on the LLM.
- **Labels and review:**
  - The dev labels are author-written, not native-speaker reviewed.
  - D1–D8 in `m10_annotation_review_summary.md` need team decisions.
  - The M9 real-speech figures use unverified labels.
- **Disclosure:** the paraphrase families were chosen after the diagnosis had shown 11 held-out
  requests in them, so held-out gains in those families are not fully blind.
