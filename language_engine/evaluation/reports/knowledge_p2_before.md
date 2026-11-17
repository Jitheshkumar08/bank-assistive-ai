# Knowledge evaluation: knowledge_p2_before

## dev
- answerable: 20, top-1 19/20, top-2 19/20
- correct top-1 scores: [0.343, 0.377, 0.489, 0.544, 0.584, 0.608, 0.655, 0.665, 0.678, 0.685, 0.691, 0.692, 0.694, 0.7, 0.711, 0.745, 0.755, 0.779, 0.806]
- unanswerable best scores: [0.074, 0.186, 0.231, 0.273, 0.309, 0.35, 0.512, 0.557, 0.58, 0.656]

## heldout
- answerable: 15, top-1 14/15, top-2 14/15
- correct top-1 scores: [0.232, 0.523, 0.545, 0.626, 0.649, 0.673, 0.684, 0.694, 0.699, 0.707, 0.714, 0.747, 0.763, 0.768]
- unanswerable best scores: [0.135, 0.157, 0.362, 0.487, 0.581]

## Abstention threshold (chosen on dev only)

- best on dev: {'threshold': 0.32, 'keep': 1.0, 'reject': 0.5}
- same threshold on held-out: {'keep': 0.929, 'reject': 0.4}

## Latency (ms, retrieval only, CPU)

- cold_first_query_ms: 17.23
- first_pass_mean_ms: 21.97
- first_pass_p95_ms: 37.26
- repeat_pass_mean_ms: 22.02
- repeat_pass_p95_ms: 34.81
- queries: 50
- index_build_ms_including_model_load: 3491.39

## Per question

| split | lang | kind | top-1 | top score | got | question |
|---|---|---|---|---|---|---|
| dev | en | answerable | yes | 0.806 | deposit_slip.md, deposit.md | What is a deposit slip? |
| dev | en | answerable | yes | 0.678 | withdrawal.md, withdrawal_slip.md | Why do I need to sign the withdrawal slip? |
| dev | en | answerable | yes | 0.377 | account_opening_requirements.md, loan_basics.md | What does KYC mean? |
| dev | en | answerable | yes | 0.343 | loan_basics.md, bank_transfer.md | What is an EMI? |
| dev | en | answerable | yes | 0.755 | current_account.md, savings_account.md | How is a current account different from a savings account? |
| dev | en | answerable | yes | 0.685 | bank_transfer.md, current_account.md | What details are needed to transfer money to another account? |
| dev | en | answerable | yes | 0.584 | passbook.md, account_number.md | What does a passbook record? |
| dev | en | answerable | yes | 0.694 | cheque_book.md, savings_account.md | Why should I keep my cheque book safe? |
| dev | en | answerable | yes | 0.665 | account_number.md, current_account.md | What happens if I write the wrong account number? |
| dev | en | answerable | yes | 0.655 | loan_basics.md, loan.md | What is the difference between a secured and unsecured loan? |
| dev | en | answerable | yes | 0.692 | banking_services.md, loan_basics.md | What services does a bank provide? |
| dev | en | answerable | NO | 0.309 | deposit_slip.md, withdrawal_slip.md | What is NEFT? |
| dev | kn | answerable | yes | 0.745 | deposit_slip.md, deposit.md | ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು |
| dev | kn | answerable | yes | 0.608 | loan.md, loan_basics.md | ಸಾಲಕ್ಕೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು |
| dev | kn | answerable | yes | 0.779 | savings_account.md, current_account.md | ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು |
| dev | hi | answerable | yes | 0.7 | passbook.md, account_number.md | पासबुक क्या होती है |
| dev | hi | answerable | yes | 0.691 | loan_basics.md, loan.md | लोन पर ब्याज क्या होता है |
| dev | hi | answerable | yes | 0.711 | account_opening.md, account_opening_requirements.md | खाता खोलने के लिए क्या चाहिए |
| dev | rom | answerable | yes | 0.489 | cheque_book.md, passbook.md | cheque book kaise milta hai |
| dev | rom | answerable | yes | 0.544 | withdrawal_slip.md, withdrawal.md | withdrawal slip mein kya likhna hai |
| dev | en | gap | - | 0.35 | loan_basics.md, account_number.md | What is the IFSC code of this branch? |
| dev | en | gap | - | 0.656 | savings_account.md, current_account.md | What is the minimum balance for a savings account here? |
| dev | en | gap | - | 0.557 | loan_basics.md, loan.md | What is the interest rate on a home loan? |
| dev | en | gap | - | 0.231 | loan_basics.md, withdrawal.md | What time does the branch close? |
| dev | en | gap | - | 0.512 | banking_services.md, account_opening_requirements.md | How do I activate net banking? |
| dev | en | gap | - | 0.58 | deposit.md, deposit_slip.md | What is a fixed deposit? |
| dev | en | unrelated | - | 0.273 | cheque_book.md, banking_services.md | What is the capital of France? |
| dev | en | unrelated | - | 0.074 | passbook.md, bank_transfer.md | Tell me a joke about cricket. |
| dev | kn | gap | - | 0.186 | cheque_book.md, current_account.md | ಇಂದು ಚಿನ್ನದ ಬೆಲೆ ಎಷ್ಟು |
| dev | hi | gap | - | 0.309 | withdrawal.md, withdrawal_slip.md | मेरा डेबिट कार्ड खो गया है तो क्या करूं |
| heldout | en | answerable | yes | 0.699 | deposit_slip.md, withdrawal_slip.md | What is a paying-in slip used for? |
| heldout | en | answerable | yes | 0.747 | loan_basics.md, banking_services.md | What is the principal of a loan? |
| heldout | en | answerable | yes | 0.707 | account_opening_requirements.md, account_opening.md | Do I need an initial deposit to open an account? |
| heldout | en | answerable | yes | 0.626 | bank_transfer.md, banking_services.md | Can I make a transfer at an ATM? |
| heldout | en | answerable | yes | 0.694 | passbook.md, bank_transfer.md | How does a passbook get updated? |
| heldout | en | answerable | yes | 0.763 | cheque_book.md, deposit.md | What is a cheque? |
| heldout | en | answerable | yes | 0.684 | current_account.md, account_number.md | Who is a current account meant for? |
| heldout | en | answerable | yes | 0.714 | loan_basics.md, loan.md | What is loan tenure? |
| heldout | en | answerable | NO | 0.402 | loan_basics.md, loan.md | What is a branch code? |
| heldout | en | answerable | yes | 0.523 | account_opening_requirements.md, account_opening.md | What will I get after my account is opened? |
| heldout | kn | answerable | yes | 0.673 | account_number.md, deposit.md | ಖಾತೆ ಸಂಖ್ಯೆ ಏಕೆ ಬೇಕು |
| heldout | kn | answerable | yes | 0.649 | current_account.md, account_number.md | ಚಾಲ್ತಿ ಖಾತೆ ಎಂದರೇನು |
| heldout | hi | answerable | yes | 0.545 | bank_transfer.md, savings_account.md | पैसे ट्रांसफर करने के लिए क्या जानकारी चाहिए |
| heldout | hi | answerable | yes | 0.768 | withdrawal_slip.md, withdrawal.md | निकासी पर्ची पर हस्ताक्षर क्यों करना होता है |
| heldout | rom | answerable | yes | 0.232 | loan_basics.md, bank_transfer.md | emi ka matlab kya hai |
| heldout | en | gap | - | 0.362 | current_account.md, deposit.md | What are the charges for a demand draft? |
| heldout | en | gap | - | 0.487 | loan_basics.md, loan.md | How long does loan approval take at this bank? |
| heldout | en | gap | - | 0.581 | deposit_slip.md, deposit.md | What is a recurring deposit? |
| heldout | en | unrelated | - | 0.135 | cheque_book.md, deposit_slip.md | Who won the football world cup? |
| heldout | hi | unrelated | - | 0.157 | banking_services.md, cheque_book.md | आज मौसम कैसा है |
