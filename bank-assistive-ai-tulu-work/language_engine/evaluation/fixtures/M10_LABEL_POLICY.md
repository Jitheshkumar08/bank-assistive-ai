# M10 label policy (development fixtures)

How every label in `m10_dev.json` was decided. Labels follow the meaning of the sentence
under this policy, never the engine's current behaviour, and never a payment-study label
copied across.

**Status: author-labelled.** The sentences and labels were written by the developer
tooling. **No native Kannada or Hindi speaker has reviewed them.**

**Policy decisions D1–D8 were approved by the project team** (`reports/m10_policy_decisions.md`).
The five rows that had waited on D1, D3 or D5 now carry `"policy": "approved:Dn"` and count in
the headline. Their labels were already the approved ones and did not change.

## The assistant's services

| Service | What it is | Workflow file |
|---|---|---|
| deposit money | cash (or cheque) paid into the customer's own bank account at the branch | `deposit.json` |
| withdraw money | cash taken out of the customer's own bank account | `withdraw.json` |
| check account balance | how much is in the customer's bank account | none ("no guided procedure yet") |
| apply for loan | a new loan application | `apply_for_loan.json` |
| open new account | a new bank account | none |

## The decision each fixture expects (`m10_expect`)

| m10_expect | Meaning | Harness category |
|---|---|---|
| `start:<service>` | a clear request for that service | `service_request` |
| `clarify` | banking, but no single supported service can be established. Ask which one. | `ambiguous_request` |
| `decline` | a banking operation the assistant does not offer (UPI, transfers, bill payments, recharges, wallets, card management, insurance, investments). Say so and list what it can do. | `ambiguous_request` |
| `question` | a question ABOUT a service (how, limits, documents, charges, why, when). Answer it; start nothing. | `knowledge_question` |
| `refusal` | the customer refuses a service | `refusal` |

`clarify` and `decline` are both "start nothing". The harness scores them the same; the
M10 evaluator also checks which of the two replies was chosen.

## Rules

1. **A request is a request whatever its form.** "how much money is in my account" is a
   balance check, not a question about balances (it asks for the customer's own data). So is
   "is there enough money in my account for X" (**D4, approved**: balance-related, without any
   claim to a live balance).
2. **A question is about how something works,** or about its limits, rules, documents, charges, time or
   reason: "how do I deposit a cheque", "what is the maximum I can withdraw", "why was my
   withdrawal refused" (**D2, approved**: answered where reliable knowledge exists, never started).
3. **A bare amount, a bare money word or an account word alone is `clarify`.** "five thousand rupees",
   "money", "I have an account question" name no single service.
4. **Moving money to a person, a wallet, a merchant or a biller is `decline`.**
   - **D1, approved:** loading one's own wallet, even from the bank account, is `decline`, never a deposit.
   - **D6, approved:** a wallet balance is `decline`, never a bank balance.
   - **D3, approved:** paying a loan instalment through a payment app is `decline`, never a loan application.
5. **A sentence that asks for a supported and an unsupported operation is `clarify`**
   (**D5, approved**). Exception: wallets and repayment through an app (rule 4) decline.
8. **An app or balance that is not showing is a complaint: `decline`** (**D7, approved**), not
   a balance check and not a refusal.
9. **An education-loan application is `start:apply for loan`** (**D8, approved**).
6. **A negation that refuses the service is `refusal`.** A negation about something else
   ("the ATM is not working, I need to withdraw cash") keeps the request: `start:withdraw money`.
   M3 documents that the refusal gate currently stops such sentences, so they are expected to fail. M10 does not
   change that gate.
7. **Code-mixed and romanised forms carry the label of the meaning,** not of the script.

## Held-out separation

No dev sentence copies or lightly edits a held-out sentence. `debugging/test_m10_routing.py`
checks the dev texts against every existing fixture file, the M9 forms and the M9 clip
transcripts.

**Disclosure:** while writing these rules, the M10 diagnosis had already listed 11 held-out
requests that a "require a service keyword" rule would break ("how much money is in my
account", "put money into the account", "take out" + money). The paraphrase families those
sentences belong to are general Kannada, Hindi and English usage, and this stage was asked to
cover them. Still, the held-out results after M10 are not fully blind for those families.
