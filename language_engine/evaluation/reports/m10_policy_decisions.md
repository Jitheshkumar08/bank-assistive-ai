# M10 approved banking-policy decisions

Decisions D1–D8 from `m10_annotation_review_summary.md`, **reviewed and approved by the project
team** (as stated in the team's approval message). This record holds the approved wording and
how each decision is implemented and tested. The review sheet `m10_annotation_review.csv` is
unchanged (SHA-256 `0dd88fb0ff321655…`). The labels in that sheet and in the M9 annotations are
not rewritten. This record supersedes the "proposed" column only.

| # | Approved policy | Routing behaviour | Reply | Tests (`debugging/test_m10_policy.py`) |
|---|---|---|---|---|
| D1 | Wallet top-up is unsupported; never a bank cash deposit. | A wallet word declines, even beside a deposit phrase. | decline sentence | en, hi, kn, kn-en, hi-en |
| D2 | Capability questions (e.g. withdrawal limits) are answered where reliable knowledge exists; mentioning a service does not start it. | Limit, how, documents, interest, charges and similar cues mean answer, not start. | existing knowledge answerer (it answers from the knowledge base or says it has no information) | en, kn, hi, hi-en |
| D3 | Loan repayment through payment apps is unsupported unless relevant knowledge exists; repayment is never a loan application. | Repayment word + payment app declines, before the question rule (the knowledge base has nothing on app repayment). Plain repayment never starts the loan workflow. | decline sentence | en, kn, hi, hi-en |
| D4 | "Is there enough money for this?" is balance-related; no live balance claimed without an authorised integration. | Routed as balance-related, never another service. The balance service has no workflow or integration; its reply states no amount. | "I understood your request, but I don't have a guided procedure for that service yet…" | en, kn, hi, hi-en |
| D5 | A supported service + an unsupported operation in one sentence: ask which. | Mixed sentence asks which request. | which-service sentence | en, hi, kn |
| D6 | Wallet balance is unsupported; never a bank-account balance. | A wallet word declines, even beside "balance". | decline sentence | en, kn, hi, hi-en |
| D7 | An app not showing a balance is a complaint / troubleshooting request, not a balance enquiry. | A display verb + a descriptive negation ("is not showing", "नहीं दिख रहा", "ತೋರಿಸ್ತಿಲ್ಲ") + an app or balance word is a complaint. Not a balance start and not a refusal. Imperatives ("don't show", "मत दिखाओ", "ತೋರಿಸಬೇಡಿ") stay refusals. | decline sentence | en, kn, hi, hi-en + routing layer |
| D8 | An education-loan application is a supported loan request (existing loan workflow scope). | Starts the loan workflow; an education-loan *question* is answered instead. | loan workflow step 1 | en, kn, hi, kn-en |

## Not covered by the approved decisions (reported, not guessed)

- **Brand-only wallets.** "क्या मेरे ऑक्सीजन खाते में पर्याप्त धनराशि है" (`ivb_hi_042`) names the wallet
  only by brand, and says खाता (account). ऑक्सीजन is also the ordinary word "oxygen", so a brand
  list cannot recognise it safely. It is routed as balance-related (D4), not declined (D6). A
  list of wallet brands to treat as wallets is a team decision.
- **A dedicated complaint reply (D7).** No troubleshooting flow or complaint wording exists. D7
  uses the existing decline sentence ("I can't help with that. I can help you deposit money…").
  Specific wording, and whether to point the customer to a help desk, would be new, translated
  text and is a team decision.
- **Knowledge for D2.** The knowledge base has no withdrawal-limit content. A limit question
  reaches the existing answerer, which says it has no information. No limit is invented.
- **LLM-gated turns.** Most capability and enough-money questions are question-shaped, so the
  dialogue LLM classifies them first. The tests check the deterministic decision if the LLM hands
  the turn back. The LLM's own answers (for example, that it never states a balance) are not
  tested here: no live LLM.
