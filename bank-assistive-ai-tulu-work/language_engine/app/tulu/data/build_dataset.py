"""Builds the Tulu dataset JSON files from the native-speaker documents.

    deposit_dataset.json     <- deposit conversation/   (Tulu_Cash_Deposit_...docx + 16 recordings)
    withdrawal_dataset.json  <- withdraw_conversation/  (Tulu_Cash_Withdrawal_...docx + 12 recordings)

The source of truth is each annotator's Word document and its recordings.
This script READS them and never writes to those folders. Each JSON file is a
faithful, machine-readable copy of the document's tables plus measured facts
about each recording, so the rest of the Tulu module never parses Word files
at runtime. The two datasets are kept in separate files and never merged.

Nothing is corrected here. Spelling variants, odd filenames, the conflicting
D04 wordings and every other oddity are carried through as they are and
listed under "discrepancies" for native-speaker review.

GROUPS. Each document table holds one assistant workflow step and the
customer utterances that should receive it. The group is therefore the
ASSISTANT row's id in the same table, not the customer id's prefix: in the
withdrawal document W03b sits in the W04 table and W04a in the W05 table, as
its notes confirm.

Run from language_engine/:

    python -m app.tulu.data.build_dataset            # both datasets
    python -m app.tulu.data.build_dataset deposit    # one
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE_ROOT = HERE.parent.parent.parent
WORKSPACE = ENGINE_ROOT.parent


def _paragraph_text(xml_fragment: str) -> str:
    return "".join(re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", xml_fragment, flags=re.S))


def _unescape(text: str) -> str:
    return (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&apos;", "'"))


def read_docx(path: Path):
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    tables = []
    for table in re.findall(r"<w:tbl>.*?</w:tbl>", xml, flags=re.S):
        rows = []
        for row in re.findall(r"<w:tr[ >].*?</w:tr>", table, flags=re.S):
            cells = [_unescape(_paragraph_text(c)).strip()
                     for c in re.findall(r"<w:tc>.*?</w:tc>", row, flags=re.S)]
            rows.append(cells)
        tables.append(rows)
    paragraphs = [_unescape(_paragraph_text(p)).strip()
                  for p in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S)]
    return tables, [p for p in paragraphs if p]


def probe_audio(path: Path) -> dict:
    """Container facts from ffprobe. Read-only."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=format_name,duration:stream=codec_name,sample_rate,channels",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(out.stdout)
    stream = info["streams"][0]
    return {
        "container": info["format"]["format_name"],
        "codec": stream["codec_name"],
        "sample_rate": int(stream["sample_rate"]),
        "channels": int(stream["channels"]),
        "duration_s": round(float(info["format"]["duration"]), 3),
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _find_audio(listed: str, on_disk: dict):
    """The delivered file for a name the document lists, tolerating case,
    an appended '.m4a' and a doubled '.wav.wav'. Never renames anything."""
    if listed in on_disk:
        return listed
    lowered = {name.lower(): name for name in on_disk}
    for candidate in (listed, listed + ".m4a", listed + ".wav"):
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    return None


# =========================================================
# DATASET-SPECIFIC FACTS (discrepancies are documented, not fixed)
# =========================================================

def _deposit_discrepancies(utterances, notes):
    d04_table = next(u["tulu_romanized"] for u in utterances if u["id"] == "D04")
    d04_note = None
    for note in notes:
        m = re.search(r"D04 assistant Tulu phrase “(.+?)” was supplied", note)
        if m:
            d04_note = m.group(1)
    return [
        {
            "id": "D04_ASSISTANT_WORDING",
            "status": "awaiting_native_speaker_confirmation",
            "description": "The D04 assistant sentence appears in two different forms.",
            "versions": [
                {"source": "dataset table, row D04 / Assistant", "tulu_romanized": d04_table},
                {"source": "Workflow and recording notes (stated as the confirmed wording)",
                 "tulu_romanized": d04_note},
            ],
            "effect": "Step 4 has NO verified Tulu rendering until resolved; it is answered in English.",
        },
        {
            "id": "SPELLING_BOKKA_BOKA",
            "status": "awaiting_native_speaker_confirmation",
            "description": "'Bokka' (D03 assistant) and 'Boka' (D04 assistant) appear to be the same word.",
            "effect": "Both spellings kept; matching folds doubled consonants, text is not changed.",
        },
        {
            "id": "SPELLING_YANK_YAN_YAAN",
            "status": "awaiting_native_speaker_confirmation",
            "description": "'Yank' (D01a-c), 'Yan' (D03b, D04c) and 'Yaan' (D02d) are written differently; "
                           "they may be different words (dative vs nominative) or spelling variants.",
            "effect": "Kept as written; not merged.",
        },
        {
            "id": "D04C_STEP_MAPPING",
            "status": "awaiting_native_speaker_confirmation",
            "description": "A note says 'Yan deposit malpuna amount bareye?' maps to D03, but the near-identical "
                           "D04c 'Yan deposit malpuna amount bareye. Next dada malpodu?' is filed under D04.",
            "effect": "The table's placement (D04) is used, as the table is the annotated record.",
        },
        {
            "id": "AAC_FILES_NAMED_WAV",
            "status": "documented",
            "description": "D01a/D01b/D01c are AAC (M4A) audio named '*.wav.m4a'; the document lists them as '.wav'.",
            "effect": "Files left as delivered; decoded with ffmpeg where needed.",
        },
        {
            "id": "D03_DEPPERE_IN_DEPOSIT",
            "status": "awaiting_native_speaker_confirmation",
            "description": "The deposit D03 assistant sentence 'Bokka eth amount deppere undu aven barele.' "
                           "(glossed 'Enter the amount to deposit') is almost identical to withdrawal W03 "
                           "'Bokka yeth amount deppere undu aven barele.' (glossed 'Enter the amount you want to "
                           "withdraw'), and 'deppere' is the withdrawal verb in W01a-c, while deposit customer "
                           "sentences use 'padare'/'padodu'. Found when the withdrawal dataset was added.",
            "effect": "D03 is kept as annotated (annotations are authoritative); a native speaker should "
                      "confirm it is correct for DEPOSIT.",
        },
    ]


def _withdrawal_discrepancies(utterances, notes):
    renamed = [u["id"] for u in utterances if u.get("audio") and not u["audio"]["name_matches_document"]]
    return [
        {
            "id": "NATIVE_SPEAKER_VERIFICATION_NOT_STATED",
            "status": "awaiting_team_confirmation",
            "description": "The document is titled 'Final' and records a user correction ('yeth' in W03b), "
                           "but does not state explicitly that a native speaker verified every sentence.",
            "effect": "Treated as the team's verified annotation, like the deposit document; to be confirmed.",
        },
        {
            "id": "FILENAMES_DIFFER_FROM_DOCUMENT",
            "status": "documented",
            "description": "Delivered files use mixed case and a doubled extension (e.g. 'W01a_Customer.wav.wav', "
                           "'w04_assistant.wav.wav') while the document lists 'W01a_CUSTOMER.wav' etc. "
                           f"Affected: {', '.join(renamed)}.",
            "effect": "Matched case-insensitively; files left as delivered.",
        },
        {
            "id": "W01B_ALTERNATIVE_WORDS",
            "status": "awaiting_native_speaker_confirmation",
            "description": "W01b is written 'Yenk yenna account d dh kaas/amount deppere undu?' -- two "
                           "alternatives ('kaas/amount') in one sentence; which one the recording contains is "
                           "not stated. 'account d dh' (two suffixes) is also unusual.",
            "effect": "Kept exactly as written; matching sees both alternative words.",
        },
        {
            "id": "CUSTOMER_IDS_VS_STEPS",
            "status": "documented",
            "description": "W03b is filed in the W04 table and W04a in the W05 table; the document's notes confirm "
                           "W03a->W03, W03b->W04, W04a->W05.",
            "effect": "Groups follow the table (assistant step), not the id prefix.",
        },
        {
            "id": "SPELLING_YENK_YANK_ETH_YETH",
            "status": "awaiting_native_speaker_confirmation",
            "description": "'Yenk' here vs 'Yank' in the deposit set; 'yeth' (W03b, W03 assistant) vs 'Eth' (W04a) "
                           "vs 'eth' (deposit D03). The document says 'yeth' in W03b was corrected by the user and "
                           "'Eth' in W04a kept as supplied.",
            "effect": "Kept as written; not merged.",
        },
        {
            "id": "DIFFERENT_SPEAKER_FROM_DEPOSIT",
            "status": "documented",
            "description": "Median F0 199-229 Hz in the 12 original withdrawal recordings (24-bit mono) vs 102-117 Hz in "
                           "the deposit set: very likely a different speaker (not verified with a speaker model).",
            "effect": "Useful for ASR evaluation across speakers; irrelevant to TTS (no cloning).",
        },
        {
            "id": "ADDED_RECORDINGS_SECOND_SPEAKER",
            "status": "documented",
            "description": "The 8 customer recordings added on 2026-11-19 (W02b-d, W03a1, W03b1-2, W04b-c) are 16-bit "
                           "stereo with median F0 111-121 Hz -- consistent with the DEPOSIT speaker, not the original "
                           "withdrawal speaker -- and the same heavily processed profile (energy above 8 kHz -55 to "
                           "-75 dB). Not verified with a speaker model.",
            "effect": "Withdrawal now has two speakers; matching and ASR treat all rows alike.",
        },
        {
            "id": "W03B1_SAME_TEXT_AS_D04B",
            "status": "documented",
            "description": "W03b1 'amount n bareye' and deposit D04b 'Amount n bareye.' are the same sentence; both mean "
                           "'I wrote the amount' and both map to the amount-entered progress step.",
            "effect": "Same meaning and pivot in both datasets, so no ambiguity.",
        },
    ]


DATASETS = {
    "deposit": {
        "folder": "deposit conversation",
        "docx": "Tulu_Cash_Deposit_Dataset_Workflow_Aligned_Final.docx",
        "output": "deposit_dataset.json",
        "workflow_file": "deposit.json",
        "discrepancies": _deposit_discrepancies,
        "consent": "not documented -- recordings must not be used for voice cloning",
    },
    "withdrawal": {
        "folder": "withdraw_conversation",
        "docx": "Tulu_Cash_Withdrawal_Dataset_Workflow_Aligned_Final.docx",
        "output": "withdrawal_dataset.json",
        "workflow_file": "withdraw.json",
        "discrepancies": _withdrawal_discrepancies,
        "consent": "not documented -- recordings must not be used for voice cloning",
    },
}

#: Canonical engine intent of each dataset's workflow (app/intent/intents.py).
WORKFLOW_OF_DATASET = {"deposit": "deposit", "withdrawal": "withdraw"}


def build(name: str, source: Path | None = None) -> dict:
    cfg = DATASETS[name]
    source = source or WORKSPACE / cfg["folder"]
    docx = source / cfg["docx"]
    tables, paragraphs = read_docx(docx)

    instructions = {}
    for para in paragraphs:
        m = re.match(r"Assistant workflow instruction:\s*(.+?)(?:\s*\(field:\s*(\w+)\))?$", para)
        if m:
            instructions[str(len(instructions) + 1)] = {"text": m.group(1).strip(), "field": m.group(2)}

    # Cross-check against the engine's workflow file: the document must
    # describe exactly the existing workflow (no Tulu-specific workflow).
    wf = json.loads((ENGINE_ROOT / "app" / "workflow" / "workflows" / cfg["workflow_file"]).read_text(encoding="utf-8"))
    engine_steps = [s["instruction"] for s in wf["steps"]]
    doc_steps = [instructions[k]["text"] for k in sorted(instructions, key=int)]
    if engine_steps != doc_steps:
        raise ValueError(f"{name}: document steps {doc_steps} != {cfg['workflow_file']} {engine_steps}")

    on_disk = {p.name: p for p in source.iterdir() if p.is_file()}
    utterances = []
    for step_index, table in enumerate(tables, start=1):
        header, *rows = table
        assert header[:4] == ["ID / Speaker", "Tulu sentence", "English meaning", "Audio filename"], header
        parsed = []
        for cells in rows:
            ident, speaker = [s.strip() for s in cells[0].split("/")]
            parsed.append((ident, speaker.lower(), cells))
        assistant_ids = [i for i, s, _ in parsed if s == "assistant"]
        assert len(assistant_ids) == 1, f"{name}: table {step_index} has assistant rows {assistant_ids}"
        group = assistant_ids[0]
        for ident, speaker, cells in parsed:
            listed = cells[3]
            actual = _find_audio(listed, on_disk)
            entry = {
                "id": ident,
                "group": group,
                "workflow": WORKFLOW_OF_DATASET[name],
                "step": step_index,
                "speaker_role": speaker,
                "tulu_romanized": cells[1],
                "english_meaning": cells[2],
                "audio_listed_in_document": listed,
                "audio_file": actual,
            }
            if actual:
                entry["audio"] = probe_audio(on_disk[actual])
                entry["audio"]["sha256"] = sha256(on_disk[actual])
                entry["audio"]["name_matches_document"] = actual == listed
            utterances.append(entry)

    notes_start = paragraphs.index("Workflow and recording notes")
    notes = paragraphs[notes_start + 1:]

    return {
        "source": {
            "folder": cfg["folder"],
            "document": cfg["docx"],
            "document_sha256": sha256(docx),
            "built_by": "app/tulu/data/build_dataset.py",
            "note": "Faithful copy of the annotator's tables. Romanized Tulu is authoritative and unmodified.",
        },
        "workflow": WORKFLOW_OF_DATASET[name],
        "step_instructions": instructions,
        "utterances": utterances,
        "document_notes": notes,
        "discrepancies": cfg["discrepancies"](utterances, notes),
        "voice_use_consent": cfg["consent"],
    }


# =========================================================
# CONVERSATION-CONTROL DATASET (no workflow; one table per control group)
# =========================================================

CONTROL = {
    "folder": "control_statement",
    "docx": "Tulu_Conversation_Control_Statements_C01-C04.docx",
    "output": "control_dataset.json",
}

#: The document's group headings (quoted) and the canonical control intent
#: each maps to. The engine action is the EXISTING deterministic control
#: command (app/dialogue/manager.py classify_command) that executes it.
CONTROL_GROUPS = {
    "C01": {"canonical": "REPEAT_STEP", "engine_command": "repeat", "mapping_confidence": "clear"},
    "C02": {"canonical": "PAUSE_WORKFLOW", "engine_command": "pause", "mapping_confidence": "clear"},
    "C03": {"canonical": "STOP_REQUEST", "engine_command": "stop",
            "mapping_confidence": "decided by the team on 2026-11-19: C03 = 'stop'. One stop cancels the open "
                                  "request at once; a second stop right after ends the conversation. The heading "
                                  "also names declining further help -- native-speaker confirmation still pending"},
    "C04": {"canonical": "CLARIFY_CURRENT_STEP", "engine_command": "help", "mapping_confidence": "clear"},
    "C05": {"canonical": "NEXT_STEP", "engine_command": "next", "mapping_confidence": "clear"},
    "C06": {"canonical": "RESUME_WORKFLOW", "engine_command": "resume", "mapping_confidence": "clear"},
}


def _control_discrepancies(utterances):
    renamed = [u["id"] for u in utterances if u.get("audio") and not u["audio"]["name_matches_document"]]
    return [
        {"id": "NATIVE_SPEAKER_VERIFICATION_NOT_STATED", "status": "awaiting_team_confirmation",
         "description": "The document does not state native-speaker verification and calls its English meanings "
                        "'working glosses'.",
         "effect": "Every row is marked verification 'not stated'; glosses stored exactly as supplied."},
        {"id": "FILENAMES_DIFFER_FROM_DOCUMENT", "status": "documented",
         "description": f"Delivered names are lower/mixed case with a doubled '.wav.wav'. Affected: {', '.join(renamed)}.",
         "effect": "Matched case-insensitively; files left as delivered."},
        {"id": "C03_HEADING_TWO_ACTIONS", "status": "awaiting_native_speaker_confirmation",
         "description": "C03 is headed 'Stopping the conversation or declining further help' -- two different "
                        "actions. The assistant reply ('let me know if you need any other help') implies the session "
                        "continues.",
         "effect": "Team decision 2026-11-19: C03 = stop. One stop cancels the open request immediately and "
                   "offers to end the conversation; a second stop right after ends it."},
        {"id": "C03_ASSISTANT_OIK", "status": "awaiting_native_speaker_confirmation",
         "description": "C03 assistant 'Okay ... nana oik andala help bodanda yenk panle ... thank you.' -- 'oik' is "
                        "unclear (possible typo).",
         "effect": "Kept verbatim."},
        {"id": "C03C_OR_THANK_U", "status": "awaiting_native_speaker_confirmation",
         "description": "C03c contains 'or' and the texting form 'thank u'; the gloss adds a second sentence.",
         "effect": "Kept verbatim."},
        {"id": "C02D_CONTAINS_CONTINUE", "status": "documented",
         "description": "C02d 'Yaan panpina muta continue malporchi' (don't continue) contains the English word "
                        "'continue', which on its own is the engine's RESUME command.",
         "effect": "Matched as a whole phrase to PAUSE; tests assert it never resumes."},
        {"id": "SLOW_SPEECH_NOT_SUPPORTED", "status": "documented",
         "description": "C01d asks for slower speech and the C01 reply promises it; the TTS has no slow mode.",
         "effect": "Mapped to repeat; speech rate is unchanged (known gap)."},
        {"id": "C06_VS_C02D", "status": "documented",
         "description": "C06a 'Continue malpule' (please continue) and C02d 'Yaan panpina muta continue malporchi' (don't "
                        "continue until I finish) share the word 'continue' but have OPPOSITE meanings.",
         "effect": "Each matched as a whole phrase; tests assert C02d pauses and C06 resumes."},
        {"id": "ADDED_GROUPS_SECOND_SPEAKER", "status": "documented",
         "description": "C05 and C06 (added 2026-11-19) are 16-bit stereo, median F0 106-132 Hz -- consistent with the "
                        "deposit speaker, not the C01-C04 speaker (195-250 Hz). Not verified with a speaker model.",
         "effect": "Control now has two speakers."},
        {"id": "DOCUMENT_OPEN_IN_WORD", "status": "documented",
         "description": "A Word lock file (~$lu_Conversation_Control_Statements_C01-C04.docx) was present when the "
                        "document was read on 2026-11-19, so it may still be being edited. The file name still says "
                        "C01-C04 although it now holds C01-C06.",
         "effect": "The saved version was used; rebuild if the document changes again."},
        {"id": "TEXT_ONLY_SUPPLEMENT", "status": "awaiting_team_confirmation",
         "description": "C04t1 'yank gothuji' ('I don't know.') was supplied by the team in chat on 2026-11-19, not "
                        "in the control document, and has NO recording. Spelling kept exactly as supplied. Placed in "
                        "C04 (clarification) by the development assistant.",
         "effect": "Typed matching only; excluded from ASR evaluation and from every recording check."},
        {"id": "NO_KANNADA_SCRIPT", "status": "documented",
         "description": "No Kannada-script forms are supplied.",
         "effect": "kannada_script is null; speech uses machine transliteration pending review."},
    ]


def build_control(source: Path | None = None) -> dict:
    source = source or WORKSPACE / CONTROL["folder"]
    docx = source / CONTROL["docx"]
    tables, paragraphs = read_docx(docx)
    headings = {}
    for para in paragraphs:
        m = re.match(r"(C\d\d)\s+—\s+(.+)$", para)
        if m:
            headings[m.group(1)] = m.group(2).strip()
    on_disk = {p.name: p for p in source.iterdir() if p.is_file()}
    utterances = []
    for table in tables:
        header, *rows = table
        assert header[:4] == ["ID / Speaker", "Tulu sentence", "English meaning", "Audio filename"], header
        parsed = [([s.strip() for s in cells[0].split("/")], cells) for cells in rows]
        group = next(ident for (ident, speaker), _ in parsed if speaker.lower() == "assistant")
        for (ident, speaker), cells in parsed:
            actual = _find_audio(cells[3], on_disk)
            entry = {
                "id": ident,
                "group": group,
                "workflow": None,
                "step": None,
                "speaker_role": speaker.lower(),
                "tulu_romanized": cells[1],
                "kannada_script": None,          # not supplied by the dataset
                "english_meaning": cells[2],     # a working gloss, exactly as supplied
                "verification": "not stated",
                "control_group_heading": headings.get(group),
                "canonical_control": CONTROL_GROUPS[group]["canonical"],
                "audio_listed_in_document": cells[3],
                "audio_file": actual,
            }
            if actual:
                entry["audio"] = probe_audio(on_disk[actual])
                entry["audio"]["sha256"] = sha256(on_disk[actual])
                entry["audio"]["name_matches_document"] = actual == cells[3]
            utterances.append(entry)
    # Text-only phrases supplied by the team outside the document (no audio).
    supplement = json.loads((HERE / "control_supplement.json").read_text(encoding="utf-8"))
    for row in supplement["rows"]:
        group = row["group"]
        utterances.append({
            "id": row["id"],
            "group": group,
            "workflow": None,
            "step": None,
            "speaker_role": row["speaker_role"],
            "tulu_romanized": row["tulu_romanized"],
            "kannada_script": None,
            "english_meaning": row["english_meaning"],
            "verification": "not stated",
            "control_group_heading": headings.get(group),
            "canonical_control": CONTROL_GROUPS[group]["canonical"],
            "audio_listed_in_document": None,
            "audio_file": None,
            "text_only": True,
            "source": row["source"],
            "group_reason": row.get("group_reason"),
        })

    notes_start = next(i for i, p in enumerate(paragraphs) if p.startswith("Audio recording instructions"))
    return {
        "source": {
            "folder": CONTROL["folder"],
            "document": CONTROL["docx"],
            "document_sha256": sha256(docx),
            "built_by": "app/tulu/data/build_dataset.py",
            "note": "Faithful copy of the annotator's tables. Romanized Tulu unmodified; English meanings are the "
                    "document's working glosses.",
        },
        "workflow": None,
        "kind": "conversation_control",
        "control_groups": {g: {"heading": headings.get(g), **CONTROL_GROUPS[g]} for g in CONTROL_GROUPS},
        "step_instructions": {},
        "utterances": utterances,
        "document_notes": paragraphs[notes_start + 1:],
        "discrepancies": _control_discrepancies(utterances),
        "voice_use_consent": "not documented -- recordings must not be used for voice cloning",
    }


def main(argv):
    names = argv[1:] or list(DATASETS) + ["control"]
    for name in names:
        if name == "control":
            data, out = build_control(), HERE / CONTROL["output"]
        else:
            data, out = build(name), HERE / DATASETS[name]["output"]
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {out.name} ({len(data['utterances'])} utterances)")


if __name__ == "__main__":
    main(sys.argv)
