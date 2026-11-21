# M10 Stage A: annotation review summary

> **Status:** D1–D8 were reviewed and approved by the project team; see
> `m10_policy_decisions.md`. The text below is the original pre-review summary, kept as written.

Source: `m10_annotation_review.csv` (34 rows, unchanged; SHA-256 `0dd88fb0ff32…`).
This summary groups those rows into the decisions a human must make. **No row has been
reviewed by a human. Nothing here changes any label.** The "proposed" column is what the
M10 diagnosis tooling suggested from the annotation notes; it is a suggestion, not a
verdict.

The annotations come from a payments ASR study (Phase 3.2B-9: payment / transfer /
balance / deposit / withdrawal / other). The assistant offers five branch services:
deposit money (cash-deposit slip), withdraw money (withdrawal slip), check account
balance, apply for loan (loan desk), open new account. The rows below are the ones where
the first scheme does not map cleanly onto the second.

## Decisions needed, by group

### D1. Wallet top-ups: deposit, or not supported? (7 rows, POLICY)

`ivb_kn_017, kn_051, kn_060, kn_077, kn_079, ivb_hi_022, hi_055`. Each one asks to move money
from the customer's own bank account into their own digital wallet (Citrus, Ola Money,
Airtel Money, MSwipe, ICICI Pockets). For example:

- `kn_060`: "ನನ್ನ ಸಿಟ್ರಸ್ ವ್ಯಾಲೆಟ್ಗೆ ಆರುನೂರು ರೂಪಾಯಿ ಟ್ರಾನ್ಸ್ಫರ್ ಮಾಡು ಪ್ಲೀಸ್" (transfer 600 to my Citrus wallet)

The annotation calls these `deposit`, and its own rule 2 says this is the call a reviewer may
flip. The assistant's deposit is a cash-deposit slip at the counter.

- **Question for the team:** is a wallet top-up a request the assistant should decline, or a deposit?
- Proposed: decline as an unsupported operation (wallets are not offered).

### D2. Capability and limit questions: answer, or start the workflow? (2 rows, POLICY)

`ivb_kn_035` "…ಗರಿಷ್ಠ ಎಷ್ಟು ದುಡ್ಡು ವಿಡ್ರಾ ಮಾಡ್ಬೌದು" and `ivb_hi_040` "…अधिकतम कितनी राशि निकाल
सकता हूँ" (what is the maximum I can withdraw). Annotation rule 3 gives a capability
question the intent of the action it asks about.

- **Question for the team:** should a question about a service be answered (knowledge base), or start that service's guided workflow?
- Proposed: answer it; start nothing.

### D3. Loan-repayment questions: loan service, or not supported? (8 rows, POLICY)

`ivb_kn_056, kn_070, kn_082, kn_097, ivb_hi_013, hi_021, hi_030, hi_061`. Each asks whether an
existing loan (education, gold, property, personal, car, consumer durable) can be repaid
through a payment app (Google Pay, Paytm, Amazon Pay, Airtel Money). For example:

- `hi_021`: "क्या मैं गूगल पे के माध्यम से … अपने पर्सनल लोन का भुगतान कर सकता हूँ"

The annotation schema files these under `other`. They name "loan", which today starts the loan
workflow (a loan *application*).

- **Question for the team:** decline (payment apps are not offered), answer as a loan question, or direct to the loan desk?
- Proposed: do not start the loan-application workflow; ask or decline.

### D4. "Is there enough / is X there?" questions: balance check? (10 rows, needs confirmation)

`ivb_kn_042, kn_047, kn_075, kn_093, kn_094, kn_096, ivb_hi_056, hi_062, hi_081, hi_100`. For example:

- `kn_047`: "ನನ್ನ … ಖಾತೆಯಲ್ಲಿ ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಇರುತ್ತಾ" (will my account have 5000?)
- `hi_062`: "क्या मेरे … खाते में नौ हज़ार रुपये का लेनदेन करने के लिए पर्याप्त पैसा है" (is there enough for a 9000 transaction?)

- **Question for the reviewer:** are these balance checks?
- Proposed: yes (balance).
- Also a language check: several are Kannada yes/no forms (ಇರುತ್ತಾ, ದುಡ್ಡಿದೆಯಾ) that a native speaker should confirm.

### D5. Multi-request utterances: which request counts? (4 rows, POLICY)

| Row | Requests | Proposed |
|---|---|---|
| `ivb_kn_016` | salary credited? then transfer 700 | **undetermined**: whether "has my salary been credited" is a balance check is a policy call |
| `ivb_kn_037` | check balance + confirm 30000 received | balance |
| `ivb_hi_089` | check balance + confirm 600 received | balance |
| `ivb_hi_011` | balance + transaction history | balance |

- **Question for the team:** when one utterance asks for a supported and an unsupported thing, should the assistant start the supported one, or ask?

### D6. Wallet balance (1 row, POLICY)

`ivb_hi_042` "क्या मेरे ऑक्सीजन खाते में पर्याप्त धनराशि है" (is there enough in my Oxigen account). Oxigen
is a wallet, but the sentence says खाता (account).

- **Question for the reviewer:** is this a bank-account balance check or an unsupported wallet enquiry?
- Proposed: ask.

### D7. Complaint about the app (1 row, POLICY)

`ivb_kn_019` "ನನ್ನ ಅಮೇಜಾನ್ ಪೆ ಅದ್ಯಾಕೆ ನನ್ನ ಬ್ಯಾಂಕ್ ಬ್ಯಾಲೆನ್ಸ್ ತೋರಸ್ತಿಲ್ಲ" (why isn't Amazon Pay showing my
bank balance).

- **Question for the team:** support complaint (decline), or balance check?
- Proposed: not a balance request.

### D8. A loan application the annotation calls "other" (1 row, label mapping)

`ivb_kn_069` "ನಾನು ಶಿಕ್ಷಣ ಸಾಲಕ್ಕೆ ಅಪ್ಲೈ ಮಾಡಬೇಕು" (I need to apply for an education loan).

- **Question for the reviewer:** confirm that this is the apply-for-loan service.
- Proposed: valid loan request. M9 scored it as out of scope because the payments schema has no loan intent.

## What M10 does with these, pending review

- **No label is changed.** M10's own development fixtures (`evaluation/fixtures/m10_dev.json`) are new
  sentences, labelled under the written policy in `evaluation/fixtures/M10_LABEL_POLICY.md`.
- **Pending-policy cases in the dev set** are wallet top-ups, loan repayment and mixed requests. They carry
  `"policy": "pending"` and are **reported separately and excluded from the headline metrics**.
- **The interim routing is conservative.** Where a policy decision is open, it starts nothing (it asks or
  declines). If the team decides otherwise for D1, D2 or D3, the change is a
  policy flip, not a safety risk: today none of them would start a wrong workflow.
- **The M9 real-speech clips are re-scored after M10 for information only.** Their labels stay unverified
  until the D1–D8 decisions are made.
