# Banking annotation schema (Phase 3.2B-9)

Schema version: 1
Applies to: `project_annotations` in `indicvoices_banking_manifest.json` (200 IndicVoices
Digital Payment Commands utterances, 100 Kannada + 100 Hindi).

## Purpose

These annotations record the banking-critical information that each **reference transcript**
contains. A later step will check whether an ASR hypothesis keeps that information, so we can
measure the errors that matter to our downstream banking workflow (a wrong amount, a changed
digit, a lost negation, a missed control command) and not only WER/CER.

They are **evaluation annotations only**. They are not training labels. No ASR model, and no
other model, is trained or fine-tuned on them.

**These are project annotation categories, not IndicVoices labels.** IndicVoices supplies only
the task name (`Digital Payment Commands`), scenario, speaker metadata, transcripts and verifier
quality flags. It has no intent, amount, identifier, negation, control or completion labels.
Every value described below is added by this project.

## How to annotate

1. Annotate from `reference_transcript` (the IndicVoices `normalized` field). Consult
   `verbatim_transcript` only to resolve an ambiguity in the reference, and say so in `notes`.
2. Do not look at any ASR output while annotating. Annotations must be fixed before hypotheses
   are compared against them.
3. Record only what is explicitly spoken. Do not infer values from context, the prompt topic or
   world knowledge.
4. When a value cannot be determined, use `null`, `unknown` or `unclear` as defined for that
   field, and explain why in `notes`. Never guess.
5. Do not correct the reference. If the reference itself looks wrong, annotate it as written and
   describe the problem in `notes`.
6. Fill every field for every utterance. `null` is a valid, deliberate value only where this
   schema allows it.

References write numbers as words (no transcript in the selected set contains a digit), so
amounts and identifiers must be converted from spoken words to the forms defined below.

## Fields

| Field | Type | Allowed values |
|---|---|---|
| `intent` | string | `payment`, `transfer`, `balance`, `deposit`, `withdrawal`, `other`, `unknown` |
| `amount` | number or null | numeric rupee value, or `null` |
| `identifier` | list of objects, or null | see below, or `null` |
| `negation` | string | `positive`, `negative`, `unclear` |
| `control_type` | string | `pause`, `resume`, `repeat`, `next`, `cancel`, `exit`, `none` |
| `completion_signal` | string | `completed`, `not_completed`, `unclear`, `not_applicable` |
| `notes` | string or null | free text in English, or `null` |

### 1. `intent`

The primary action the speaker asks for. Use exactly one value.

| Value | Use when the speaker asks to |
|---|---|
| `payment` | pay a merchant, biller or service: a bill, recharge, purchase or fee |
| `transfer` | send money to a person or to an account, including the speaker's own other account |
| `balance` | check an account or wallet balance |
| `deposit` | put money into the speaker's own account or wallet |
| `withdrawal` | take money out of an account or wallet, for example as cash |
| `other` | do something clear that is not listed above, such as transaction history, a statement, blocking a card, setting an alert, a loan or insurance query, or KYC |
| `unknown` | (use this value when the request cannot be determined from the reference) |

Rules:

- If the recipient is a person or an account, use `transfer`. If it is a merchant, biller or
  service, use `payment`. If the recipient type is not stated, follow the verb: "pay" means
  `payment`, while "send" or "transfer" means `transfer`.
- If the utterance contains several requests, the primary intent is the main requested action.
  If two requests carry equal weight, take the first one in utterance order and list the others
  in `notes`.
- An utterance that is only a control command (for example "stop") gets `intent: "other"` and
  the matching `control_type`.

### 2. `amount`

The monetary value that the primary intent operates on, as a JSON number in rupees.

- Use `null` if no amount is spoken, or if the spoken amount cannot be determined exactly.
- Convert spoken numbers with Indian numbering: 1 lakh = 100000 and 1 crore = 10000000.
  Paise become decimals, so "ten rupees fifty paise" is `10.5`.
- Account numbers, phone numbers, dates, counts and step numbers are not amounts.
- If several amounts are spoken, record the one for the primary intent and list the others in
  `notes`.
- If the only monetary value is a condition, such as "alert me when the balance falls below
  five thousand", record it (`5000`) and say in `notes` that it is a threshold.
- An approximate amount ("about five hundred") is `null`, with the spoken words in `notes`.
- If a currency other than rupees is explicitly spoken, record the number and name the currency
  in `notes`.

### 3. `identifier`

Every account number, UPI ID, reference or transaction number, phone number, IFSC code, card
number (or partial card number), customer ID or similar identifier that is explicitly spoken.
Use `null` if there is none.

Otherwise record a list with one object per identifier, in spoken order:

```json
{"type": "account_number", "digits": "004512", "span": "<exact words from reference_transcript>"}
```

- `type` is one of `account_number`, `upi_id`, `reference_number`, `phone_number`, `ifsc`,
  `card_number`, `customer_id` or `other`.
- `digits` is the numeric part as an ASCII digit **string**, preserving the exact spoken digit
  sequence. Keep leading zeros and do not add or remove digits. Use `null` if the identifier has
  no numeric part.
  - Digits spoken one by one are written one by one: "zero zero four five" is `"0045"`.
  - A digit group spoken as a number is written as that number: "ninety eight" is `"98"`.
  - Repeat words expand: "double nine" is `"99"`, and "triple zero" is `"000"`.
- `span` is the exact words from `reference_transcript` that express the identifier, copied
  unchanged in the reference script.
- If any digit cannot be determined from the reference, set `digits` to `null`, keep `span`, and
  explain in `notes`.
- Bank names, payee names and app names are not identifiers. Mention them in `notes` only if
  they matter.

### 4. `negation`

Whether an explicit negation changes the meaning of the primary request, or of the condition or
status it refers to.

| Value | Meaning |
|---|---|
| `positive` | no negation bears on the request |
| `negative` | a negation bears on the request, e.g. "do not transfer", "I have not received the money", "if the payment does not go through" |
| `unclear` | a negation is present but its scope cannot be determined |

- Negation means explicit negating words or morphemes, for example Hindi नहीं, मत and न, or
  Kannada ಬೇಡ, ಇಲ್ಲ and ಅಲ್ಲ.
- "Cancel" or "stop" without a negating word is not negation. It is captured by `intent` or
  `control_type`.
- For `negative` and `unclear`, quote the negation words from the reference in `notes`.

### 5. `control_type`

A workflow control command in the utterance. The values match the controls handled by the
downstream dialogue manager (`app/dialogue/manager.py`: pause, resume, cancel, repeat and next,
plus session exit).

| Value | The speaker asks the assistant to |
|---|---|
| `pause` | wait, hold or pause |
| `resume` | continue after a pause |
| `repeat` | say the last instruction or step again |
| `next` | move to the next step |
| `cancel` | cancel the current task or transaction |
| `exit` | end the session |
| `none` | (use this value when no control command is present) |

- Use `none` for ordinary banking requests. It is expected to be the most common value.
- If more than one control appears, record the first and list the rest in `notes`.

### 6. `completion_signal`

Whether the speaker reports that an action they carried out is finished. This mirrors the
workflow's step-completion signal (`app/dialogue/completion_semantics.py`).

| Value | Meaning |
|---|---|
| `completed` | the speaker states an action is done, e.g. "I have entered the amount", "I have paid the bill" |
| `not_completed` | the speaker states an action is not done, not yet done or failed, e.g. "I have not entered it yet" |
| `unclear` | the speaker reports on an action but it is ambiguous whether it is finished |
| `not_applicable` | no statement about finishing an action, e.g. commands, requests and questions |

- Questions about status ("has my payment gone through?") are `not_applicable`.
- `not_applicable` is expected for most Digital Payment Commands, which are mainly requests.

### 7. `notes`

Free text in English, or `null` when there is nothing to add. Use it for:

- secondary intents, extra amounts and extra controls
- the reason a field is `null`, `unknown` or `unclear`
- negation words (required for `negative` and `unclear`)
- any use of `verbatim_transcript`
- problems in the reference itself

## Illustrative example

The utterance below is invented to show the format. It is **not** taken from the dataset.

> English gloss: "Please do not send ten thousand rupees to account zero zero four five one two
> today."

```json
"project_annotations": {
  "intent": "transfer",
  "amount": 10000,
  "identifier": [
    {"type": "account_number", "digits": "004512", "span": "<exact words from reference_transcript>"}
  ],
  "negation": "negative",
  "control_type": "none",
  "completion_signal": "not_applicable",
  "notes": "Negation: 'do not' applies to the transfer."
}
```

## Provenance

When annotations are added, record at manifest level the schema version, annotator(s), date,
and whether a second pass or agreement check was done. Do not change the frozen selection:
`utterances` order, IDs and dataset fields stay exactly as selected.
