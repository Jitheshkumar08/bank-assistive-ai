# Banking reference annotation report (Phase 3.2B-9, step 2)

Date: 2026-09-23
Annotations: `indicvoices_banking_annotations.json` (200 rows)
Manifest: `indicvoices_banking_manifest.json`, sha256 `02a77306…9427`, **unchanged by this step**
Schema: `banking_annotation_schema.md` (version 1)
Validator: `validate_banking_annotations.py`

## What was annotated and how

All 200 frozen utterances (100 Kannada, 100 Hindi) were annotated from the
`reference_transcript` field alone. No audio was heard and no ASR output was consulted; ASR has
not been run on this set. Annotations are stored in a separate file and joined to the manifest
by `id`, so the frozen selection is untouched.

**These are a model first pass, not verified ground truth.** Each value is a careful reading of
the reference text, but the whole set needs human review before it is used to score ASR. The
four rows in "Manual review" below are the ones that could not be settled from the reference at
all; the other 196 are confident readings, which is not the same as verified.

## Validation results

| Check | Result |
|---|---|
| 1. Rows | 200 |
| 2. Row IDs and order | identical to the frozen manifest |
| 3. Reference transcripts | byte-for-byte identical to the manifest |
| 4. Duplicate IDs | 0 |
| 5. Languages | 100 Kannada + 100 Hindi |
| 6. Unique speakers | 200 |
| 7. Frozen manifest SHA-256 | unchanged (`02a77306…9427`) |
| Schema conformance | all enum values legal; every `amount` a positive number or null; every identifier `span` an exact substring of its reference; every `digits` an ASCII digit string or null |

## Distribution

| Intent | Kannada | Hindi | Total |
|---|---|---|---|
| other | 67 | 57 | 124 |
| transfer | 15 | 25 | 40 |
| balance | 8 | 11 | 19 |
| payment | 4 | 4 | 8 |
| deposit | 5 | 2 | 7 |
| withdrawal | 1 | 1 | 2 |
| unknown | 0 | 0 | 0 |

`other` dominates because Digital Payment Commands prompts cover a wide span of app operations
(rewards, notifications, QR codes, card management, transaction history, loan and insurance
queries) that the six banking categories do not name.

| Field | Values |
|---|---|
| negation | positive 197, negative 3 (kn 1, hi 2), unclear 0 |
| control_type | none 199, cancel 1 (kn), all other values 0 |
| completion_signal | not_applicable 199, not_completed 1 (hi), completed 0, unclear 0 |
| amount | present on 81 rows (kn 38, hi 43), null on 119 |
| identifier | present on 35 rows (kn 18, hi 17), null on 165 |

Identifier entries by type: UPI ID 16, account number 15, phone number 6, other 3 (40 entries
across 35 rows). Two entries have `digits: null` because the spoken sequence is ambiguous.

Nulls are expected, not gaps: `amount` is null when no amount is spoken, `identifier` when no
identifier is spoken, and `notes` is null on 5 rows that needed no comment. No row is
`intent: unknown`, and nothing is `negation: unclear` or `completion_signal: unclear`.

### What the low counts mean for the evaluation

Three fields are nearly constant across this set: negation (3 negative), control_type (1
cancel), and completion_signal (1 not_completed). This set therefore cannot measure whether ASR
preserves negation, control commands or completion reports; those categories are too rare here
to produce a meaningful score. This is a property of the Digital Payment Commands prompts, which
are mostly first-person requests, and is worth deciding about before the ASR comparison. Amounts
(81 rows) and identifiers (35 rows, 40 entries, 450 spoken digits) are well represented and are the
strongest signal this set offers.

## Interpretation rules applied

The schema leaves genuine choices open. These were applied consistently, and are recorded in
`interpretation_rules` in the annotation file so a reviewer can flip any of them in one pass:

1. **payment vs transfer** follows the destination: a person, organisation, or the speaker's own
   other account is `transfer` even when the verb is "pay"; a merchant, biller or service is `payment`.
2. **deposit** is used for money moved into the speaker's own wallet or account, even when the
   spoken verb is "transfer". This overlaps the schema's `transfer` definition and is the most
   likely call to be flipped: it affects `ivb_kn_017`, `ivb_kn_051`, `ivb_kn_060`, `ivb_kn_077`,
   `ivb_kn_079`, `ivb_hi_022`, `ivb_hi_055`.
3. **Capability and limit questions** take the intent of the action asked about ("what is my
   maximum withdrawal" is `withdrawal`), rather than `other`.
4. **Loan and insurance queries** are `other`, as the schema specifies.
5. **control_type** is non-`none` only for dialogue or session control, or for stopping the
   action in progress. Cancelling a standing instruction (autopay, SIP deduction) is a banking
   operation, so it stays `none` with an explanation in notes. Only `ivb_kn_024` ("stop
   processing the payment") was read as `cancel`.
6. **Multi-request utterances** take the first request in utterance order as primary; the rest go
   in notes. Where that choice also moves the amount, the row is flagged.
7. **amount** holds only the value tied to the primary intent. Thresholds ("alert me below X")
   and intended transaction sizes ("enough for a X transaction") are recorded with a note.
   Fractions ("a quarter of it"), dates, times and durations are never amounts.
8. **negation** stays `positive` unless an explicit negation bears on the request. Alternative
   questions ("has it come or not"), lexical failure words (विफल, "failed") and cancel verbs are
   not negation.

## Manual review (4 rows)

| ID | Why |
|---|---|
| `ivb_kn_001` | Account number digit count is ambiguous: "ಎಂಟಕ್ಕೆ ಎಂಟು" is either one 8 carrying the dative case suffix or two 8s, giving 11 or 12 digits. `digits` is null. |
| `ivb_kn_016` | Two substantive requests: check whether salary was credited, then transfer 700 conditionally. The order rule makes the status check primary, which leaves `amount` null and strands the 700 in notes. |
| `ivb_kn_072` | Account number is spoken as grouped numbers, and "ಎಪ್ಪತ್ತ ಒಂದು" is ambiguous between 71 and 70 followed by 1, giving 11 or 12 digits. `digits` is null. |
| `ivb_hi_097` | "असमर्थ हूँ" (I am unable) is a lexical negative with the privative prefix अ-, not a negation particle such as नहीं. Marked `negative` and `not_completed`; both readings are borderline. |

## Observations for the reviewer

These do not change any annotated value but are worth knowing before scoring:

- **Digit lengths.** Several spoken phone numbers have 11 digits where an Indian mobile number
  has 10 (`ivb_kn_014`, `ivb_kn_015`, `ivb_kn_018`, `ivb_kn_062`, `ivb_kn_076`, `ivb_hi_048`),
  and several UPI IDs likewise. Digits are recorded exactly as spoken, never padded or trimmed.
- **Digit styles vary** and each is a distinct challenge for ASR: digit-by-digit in Kannada or
  Hindi, English numerals in native script (`ivb_kn_020`, `ivb_hi_002`, `ivb_hi_045`), grouped
  two-digit numbers (`ivb_kn_072`, `ivb_hi_065`, `ivb_hi_066`), and repeat words that expand,
  such as "ತ್ರಿಬಲ್ ನೈನ್" to 999 and "डबल सिक्स" to 66.
- **Reference spelling variants** appear inside digit sequences and were read as the intended
  numeral: "साथ" for सात (7) in `ivb_hi_031`, "नो" for नौ (9) in `ivb_hi_074`, "दौ" for दो (2)
  in `ivb_hi_054`.
- **`ivb_hi_005` ends mid-word** ("सक"), so that recording looks clipped. The annotated fields
  are unaffected, but it may deserve a listen once audio is extracted.
- **Dates spoken as digit runs** (`ivb_kn_059`, `ivb_kn_087`, `ivb_hi_038`) are neither amounts
  nor identifiers, so the schema captures nothing for them even though a wrong digit would
  change the request. Two of these ranges end before they start, as spoken.
