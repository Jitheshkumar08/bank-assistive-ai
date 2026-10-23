"""
Proactive assistance and field help -- a small, curated catalogue.

Two things a customer standing at a form can get without asking the LLM:

  - an OFFER of help, when they have been quiet for a while on a step that
    is still in progress (chosen by service/assistance.offer_assistance);
  - an EXPLANATION of the current field, when they say "help" (the
    deterministic `help` control command in DialogueManager).

Which field a step is about comes from the workflow definition itself --
the optional "field" key on a step in app/workflow/workflows/*.json --
never from the wording of anything the assistant said. A step without one
is "general".

Every sentence here is fixed English, rendered into Kannada and Hindi by the
existing localizer from localization_catalog.SENTENCES, like every other
fixed reply. Nothing is generated, and nothing here moves a workflow: an
offer or an explanation never completes, advances, confirms or cancels
anything.

REVIEW STATUS: the English wording and its Kannada and Hindi renderings
were authored by the development assistant and are AWAITING NATIVE-SPEAKER
AND BANK REVIEW, like the rest of localization_catalog.
"""

ACCOUNT_NUMBER = "account_number"
AMOUNT = "amount"
NAME = "name"
DATE = "date"
SIGNATURE = "signature"
GENERAL = "general"

FIELD_TYPES = (ACCOUNT_NUMBER, AMOUNT, NAME, DATE, SIGNATURE, GENERAL)

#: Said at the end of every offer, so the expected answer is the one word
#: the deterministic tier recognises. "Help" in Kannada and Hindi is
#: rendered with the same words the control tier accepts (ಸಹಾಯ / मदद).
SAY_HELP = "Just say help."

#: Offers, per field. Each has more than one wording with the SAME meaning,
#: so a customer who hears a second offer does not hear the identical
#: sentence again. Ids are stable: the caller passes back the last one.
PROMPTS = {
    ACCOUNT_NUMBER: (
        ("account_number.1",
         "Take your time. Are you having difficulty entering the account number? "
         "I can help if you need me. " + SAY_HELP),
        ("account_number.2",
         "Take your time. Do you need help with the account number? " + SAY_HELP),
    ),
    AMOUNT: (
        ("amount.1", "Would you like me to explain how to enter the amount? " + SAY_HELP),
        ("amount.2", "Take your time. Do you need help with the amount? " + SAY_HELP),
    ),
    NAME: (
        ("name.1",
         "Would you like help with the spelling or the information needed in this field? "
         + SAY_HELP),
        ("name.2", "Take your time. Do you need help with your name? " + SAY_HELP),
    ),
    DATE: (
        ("date.1", "Would you like help with the date on this form? " + SAY_HELP),
        ("date.2", "Take your time. Do you need help with the date? " + SAY_HELP),
    ),
    SIGNATURE: (
        ("signature.1", "Would you like help with where to sign? " + SAY_HELP),
        ("signature.2", "Take your time. Do you need help with the signature? " + SAY_HELP),
    ),
    GENERAL: (
        ("general.1", "Would you like some assistance with this step? " + SAY_HELP),
        ("general.2", "Take your time. Do you need help with this step? " + SAY_HELP),
    ),
}

#: What "help" explains, per field. Deliberately general: nothing here is a
#: bank-specific rule, and the step's own instruction is restated after it.
FIELD_HELP = {
    ACCOUNT_NUMBER: "Your account number is printed in your passbook. "
                    "Write it exactly as it appears there.",
    AMOUNT: "Write the amount in numbers, and also in words if the slip has a space for it.",
    NAME: "Write your name exactly as it appears in your bank records.",
    DATE: "Write today's date in the date field.",
    SIGNATURE: "Sign in the space marked for your signature, "
               "the same way you sign for your bank account.",
    GENERAL: "If anything on this step is unclear, the bank staff can also help you.",
}


def step_field(step):
    """The field a workflow step is about, from its definition. Never guessed."""
    field = step.get("field") if isinstance(step, dict) else None
    return field if field in FIELD_TYPES else GENERAL


def choose_prompt(field, avoid=None):
    """
    (prompt_id, text) for `field`, never the variant whose id is `avoid`.

    Deterministic: the variant after `avoid` when it belongs to this field,
    otherwise the first. With a single variant there is nothing else to say.
    """
    variants = PROMPTS.get(field) or PROMPTS[GENERAL]
    ids = [prompt_id for prompt_id, _ in variants]

    if avoid in ids:
        return variants[(ids.index(avoid) + 1) % len(variants)]

    return variants[0]


def field_help(field):
    """The explanation for `field`; the general one for anything unknown."""
    return FIELD_HELP.get(field, FIELD_HELP[GENERAL])
