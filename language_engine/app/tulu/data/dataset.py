"""Read-only access to the verified Tulu datasets.

Two separate files, never merged on disk:

    deposit_dataset.json     workflow "deposit"   (D01-D04)
    withdrawal_dataset.json  workflow "withdraw"  (W01-W05)

Every utterance returned here carries a runtime-only "dataset" key naming the
file it came from, so labels from the two datasets can never be confused.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
WORKSPACE = DATA_DIR.parents[3]

DATASET_FILES = {"deposit": "deposit_dataset.json", "withdrawal": "withdrawal_dataset.json",
                 "control": "control_dataset.json"}
DATASET_PATH = DATA_DIR / DATASET_FILES["deposit"]       # kept for older callers

#: Short canonical intent id -> the engine's canonical intent (app/intent/intents.py).
INTENTS = {"deposit": "deposit money", "withdraw": "withdraw money"}

START = "start"         # the utterance asks for a service: carries an intent
PROGRESS = "progress"   # the utterance reports progress inside a workflow: no intent
CONTROL = "control"     # conversation control (repeat, pause, ...): never a service intent

#: Each customer group: its role, and the English pivot the EXISTING engine
#: receives. Start pivots name the service. Progress pivots are deliberately
#: workflow-NEUTRAL ("I have taken the slip.", not "...the deposit slip.") so a
#: progress phrase from the deposit set can never steer a withdrawal visit,
#: or vice versa: the engine applies it to whichever workflow is active.
#: Headings are quoted from the two dataset documents.
GROUPS = {
    "D01": {"role": START, "intent": "deposit", "pivot_en": "I want to deposit money.",
            "document_heading": "Customer wants to deposit money"},
    "D02": {"role": PROGRESS, "pivot_en": "I have taken the slip.",
            "document_heading": "Customer has taken the deposit slip and asks what to do"},
    "D03": {"role": PROGRESS, "pivot_en": "I have filled in the account number.",
            "document_heading": "Customer has filled in the account number"},
    "D04": {"role": PROGRESS, "pivot_en": "I have entered the amount.",
            "document_heading": "Customer has completed the slip"},
    "W01": {"role": START, "intent": "withdraw", "pivot_en": "I want to withdraw money.",
            "document_heading": "Customer wants to withdraw money"},
    "W02": {"role": PROGRESS, "pivot_en": "I have taken the slip.",
            "document_heading": "Customer has taken the withdrawal slip and asks what to do"},
    "W03": {"role": PROGRESS, "pivot_en": "I have filled in the account number.",
            "document_heading": "Customer has filled in the account number"},
    "W04": {"role": PROGRESS, "pivot_en": "I have entered the amount.",
            "document_heading": "Customer has filled in the withdrawal amount"},
    "W05": {"role": PROGRESS, "pivot_en": "I have signed the slip.",
            "document_heading": "Customer has signed the withdrawal slip"},
    # Conversation control (control_dataset.json). The pivot is the EXISTING
    # engine's own deterministic control word (app/dialogue/manager.py
    # classify_command), so these turns are executed by the existing control
    # tier, before -- and without -- any LLM call.
    "C01": {"role": CONTROL, "control": "REPEAT_STEP", "pivot_en": "repeat",
            "document_heading": "Asking the assistant to repeat or speak slowly"},
    "C02": {"role": CONTROL, "control": "PAUSE_WORKFLOW", "pivot_en": "pause",
            "document_heading": "Asking the assistant to wait or pause"},
    # Team decision 2026-11-19: C03 = "stop". In a Tulu session one stop CANCELS
    # the open request at once and offers to end the conversation; a second
    # stop right after ENDS the conversation (service/main.py _tulu_stop).
    "C03": {"role": CONTROL, "control": "STOP_REQUEST", "pivot_en": "stop",
            "document_heading": "Stopping the conversation or declining further help",
            "mapping_decided_by": "team, 2026-11-19 (native-speaker confirmation pending)"},
    "C04": {"role": CONTROL, "control": "CLARIFY_CURRENT_STEP", "pivot_en": "help",
            "document_heading": "Asking for clarification or another explanation"},
    "C05": {"role": CONTROL, "control": "NEXT_STEP", "pivot_en": "next",
            "document_heading": "Asking what comes next"},
    "C06": {"role": CONTROL, "control": "RESUME_WORKFLOW", "pivot_en": "resume",
            "document_heading": "Asking the assistant to continue"},
}

#: How each control's Tulu reply is composed with the situation (see
#: service/main.py _compose_tulu_control_reply). Derived from the English
#: meaning of each group's assistant reply:
#:   C01 "Okay, I'll repeat it slowly."              -> reply + the current step
#:   C02 "Okay, take your time. I'll wait ..."        -> reply only (paused)
#:   C03 "Okay, let me know if you need other help."  -> 1st stop: cancel the request,
#:        reply + "Say stop again to end the conversation."; 2nd stop: exit
#:   C04 "No problem, I'll explain it again to you."  -> reply + explanation + current step
#:   C05 "I will say what to do next."                -> reply + the current step
#:   C06 "Okay, I'll continue your request."          -> reply + the current step
CONTROL_REPLY_PLAN = {
    "C01": {"with_step": True, "with_explanation": False},
    "C02": {"with_step": False, "with_explanation": False},
    "C03": {"with_step": False, "with_explanation": False, "stop": True},
    "C04": {"with_step": True, "with_explanation": True},
    "C05": {"with_step": True, "with_explanation": False},
    "C06": {"with_step": True, "with_explanation": False},
}

#: Canonical control intents implemented for Tulu (only those the dataset covers).
CONTROL_INTENTS = {g["control"]: g["pivot_en"] for g in GROUPS.values() if g["role"] == CONTROL}

#: Backwards-compatible view used by older code: group -> pivot info.
GROUP_PIVOTS = GROUPS
WORKFLOW_INTENT = {"deposit": INTENTS["deposit"], "withdraw": INTENTS["withdraw"]}


@lru_cache(maxsize=None)
def load_dataset(name: str = "deposit") -> dict:
    data = json.loads((DATA_DIR / DATASET_FILES[name]).read_text(encoding="utf-8"))
    for utt in data["utterances"]:
        utt["dataset"] = name
    return data


def dataset_names() -> list[str]:
    return [n for n in DATASET_FILES if (DATA_DIR / DATASET_FILES[n]).exists()]


def all_utterances() -> list[dict]:
    return [u for n in dataset_names() for u in load_dataset(n)["utterances"]]


def audio_utterances() -> list[dict]:
    """Rows that HAVE a recording. Text-only rows (e.g. control_supplement.json)
    are excluded: they are never ASR evaluation data and never a recording."""
    return [u for u in all_utterances() if u.get("audio_file")]


def customer_utterances() -> list[dict]:
    return [u for u in all_utterances() if u["speaker_role"] == "customer"]


def assistant_utterances() -> list[dict]:
    """Assistant replies of the WORKFLOW datasets (each renders one workflow step)."""
    return [u for u in all_utterances() if u["speaker_role"] == "assistant" and u.get("step") is not None]


def control_replies() -> dict[str, dict]:
    """Control group -> its one shared assistant reply (control_dataset.json)."""
    return {u["group"]: u for u in all_utterances()
            if u["speaker_role"] == "assistant" and u["dataset"] == "control"}


def audio_path(utt: dict) -> Path:
    """Where the original recording lives. Read-only."""
    folder = load_dataset(utt["dataset"])["source"].get("folder", "deposit conversation")
    return WORKSPACE / folder / utt["audio_file"]


def step_text(utt: dict) -> str:
    """The workflow instruction (English) of the step an utterance belongs to."""
    return load_dataset(utt["dataset"])["step_instructions"][str(utt["step"])]["text"]


def disputed_ids() -> set[str]:
    """Assistant utterance ids whose wording is awaiting native-speaker confirmation."""
    disputed = set()
    for name in dataset_names():
        for item in load_dataset(name)["discrepancies"]:
            if item["id"] == "D04_ASSISTANT_WORDING" and item["status"] != "resolved":
                disputed.add("D04")
    return disputed
