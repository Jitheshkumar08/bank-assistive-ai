"""
TULU OFFLINE TESTS -- no model, no network.

  1. Dataset: built from the annotator's document, faithful, discrepancies kept.
  2. Normalization: script detection, language labels kept separate, Kannada
     text never claimed as Tulu without verified Tulu words.
  3. Transliteration: deterministic, verified assistant sentences as expected.
  4. Understanding: every verified customer utterance maps to its step.
  5. Translation: steps 1-3 verified Tulu; step 4 (disputed) and other
     workflows stay English; localize_detailed() honours that; kn/hi/en unchanged.
  6. Speech plan / voice: Tulu session reads Kannada-script Tulu with the
     Kannada voice and English fallback with the English voice.
  7. TTS module: generates from text only (injected generator), never reads
     a dataset file, refuses empty text.
  8. ASR wrapper: accepts only verified matches, refuses otherwise.

Run from language_engine/:
    python -m app.tulu.tests.test_tulu_offline
"""

from __future__ import annotations

import asyncio
import builtins
import sys

from app.tulu.data.dataset import customer_utterances, load_dataset
from app.tulu.intent.matcher import KEYWORD_CUE, PASSTHROUGH, VERIFIED_MATCH, understand
from app.tulu.normalization.text import classify_text, detect_script, roman_to_kannada
from app.tulu.translation import renderer

PASSED, FAILED = [], []


def check(label, condition, detail=""):
    (PASSED if condition else FAILED).append(label)
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{(' -- ' + str(detail)) if detail and not condition else ''}")


def test_dataset():
    print("\n[1] dataset (deposit)")
    d = load_dataset("deposit")
    utts = d["utterances"]
    check("16 utterances (12 customer, 4 assistant)",
          len(utts) == 16 and sum(u["speaker_role"] == "customer" for u in utts) == 12)
    check("every utterance has an audio file on disk", all(u["audio_file"] for u in utts))
    aac = sorted(u["id"] for u in utts if u["audio"]["codec"] == "aac")
    check("the three AAC files are recorded as such", aac == ["D01a", "D01b", "D01c"], aac)
    check("AAC files flagged as not matching the document's .wav names",
          all(not u["audio"]["name_matches_document"] for u in utts if u["id"] in aac))
    check("Romanized text copied verbatim (spot check D03)",
          next(u for u in utts if u["id"] == "D03")["tulu_romanized"] == "Bokka eth amount deppere undu aven barele.")
    d04 = next(x for x in d["discrepancies"] if x["id"] == "D04_ASSISTANT_WORDING")
    check("both D04 wordings preserved, unresolved",
          [v["tulu_romanized"] for v in d04["versions"]] ==
          ["Slip Boka amount n cash counter d korle.", "Slip Boka amount n korle."]
          and d04["status"] == "awaiting_native_speaker_confirmation")
    check("step instructions match deposit.json",
          [d["step_instructions"][k]["text"] for k in "1234"] ==
          ["Please take a deposit slip.", "Fill in your account number.",
           "Enter the amount to deposit.", "Submit the slip along with the cash."])


def test_normalization():
    print("\n[2] normalization and language labels")
    check("script: latin", detect_script("Yank duddu padodu?") == "latin")
    check("script: kannada", detect_script("ಯಂಕ್ ದುಡ್ಡು") == "kannada")
    check("Romanized Tulu -> tcy-Latn", classify_text("Yank duddu padodu?")["label"] == "tcy-Latn")
    check("Kannada-script Tulu -> tcy-Knda", classify_text("ಯಂಕ್ ದುಡ್ಡು ಪಡೊಡು")["label"] == "tcy-Knda")
    check("Kannada language is NOT labelled Tulu",
          classify_text("ನಾನು ಹಣ ಜಮಾ ಮಾಡಬೇಕು")["label"] == "kn-or-unknown")
    check("English is labelled English", classify_text("I want to deposit money")["label"] == "en")


def test_transliteration():
    print("\n[3] transliteration (pending native review)")
    expected = {
        "Okay, first er cash deposit dh slip dethonle.": "ಓಕೆ, ಫಸ್ಟ್ ಎರ್ ಕ್ಯಾಶ್ ಡೆಪಾಸಿಟ್‌ದ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ.",
        "Ait erna account number barele.": "ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ.",
        "Bokka eth amount deppere undu aven barele.": "ಬೊಕ್ಕ ಎತ್ ಅಮೌಂಟ್ ದೆಪ್ಪೆರೆ ಉಂಡು ಅವೆನ್ ಬರೆಲೆ.",
        "Yank duddu padodu?": "ಯಂಕ್ ದುಡ್ಡು ಪಡೊಡು?",
    }
    for src, want in expected.items():
        got = roman_to_kannada(src)
        check(f"'{src}'", got == want, got)
    check("deterministic", roman_to_kannada("Slip dethond aand?") == roman_to_kannada("Slip dethond aand?"))


def test_understanding():
    print("\n[4] understanding -> English pivot (deposit regression)")
    for u in customer_utterances():
        if u["dataset"] != "deposit":
            continue
        r = understand(u["tulu_romanized"])
        want_intent = "deposit money" if u["group"] == "D01" else None
        check(f"{u['id']} -> group {u['group']} (verified match, intent {want_intent})",
              r.method == VERIFIED_MATCH and r.group == u["group"] and r.intent == want_intent
              and r.source_dataset == "deposit",
              (r.method, r.group, r.intent, r.score))
    r = understand("yank duddu padodu andh")
    check("variant with verified deposit words still -> deposit", r.intent == "deposit money", r.method)
    r = understand("duddu padare")
    check("verified keyword cue -> deposit start", r.method in (VERIFIED_MATCH, KEYWORD_CUE) and r.group == "D01")
    r = understand("I want to apply for a loan")
    check("non-Tulu text passed through unchanged, flagged unverified",
          r.method == PASSTHROUGH and r.pivot_en == "I want to apply for a loan" and r.intent is None)


def test_translation():
    print("\n[5] translation (mapping)")
    from app.dialogue.localization import (FALLBACK, TRANSLATED, UNSUPPORTED_LANGUAGE,
                                           GeneratedText, localize_detailed)
    from app.dialogue.localization_catalog import INSTRUCTIONS

    cov = renderer.coverage("deposit")
    check("steps 1-3 verified, step 4 disputed",
          list(cov.values()) == ["verified"] * 3 + ["disputed (awaiting native-speaker confirmation)"], cov)
    text, status = localize_detailed("Please take a deposit slip.", "tcy")
    check("tcy step 1 -> verified Tulu (Kannada script), TRANSLATED",
          status == TRANSLATED and text == roman_to_kannada("Okay, first er cash deposit dh slip dethonle."), text)
    text, status = localize_detailed("Submit the slip along with the cash.", "tcy")
    check("tcy step 4 stays English (disputed)", text == "Submit the slip along with the cash."
          and status == UNSUPPORTED_LANGUAGE)
    text, status = localize_detailed("Please take a loan application form.", "tcy")
    check("tcy text without verified Tulu stays English", text == "Please take a loan application form."
          and status == UNSUPPORTED_LANGUAGE)
    text, status = localize_detailed("Okay. Fill in your account number. Let me know when you've completed it.", "tcy")
    check("tcy mixed reply: verified sentence rendered, rest English, FALLBACK",
          status == FALLBACK and "ಐಟ್ ಎರ್ನ" in text and text.startswith("Okay.")
          and text.endswith("Let me know when you've completed it."), text)
    text, status = localize_detailed(GeneratedText("Some LLM answer.", "en"), "tcy")
    check("tcy LLM text passed through in English", text == "Some LLM answer.")
    check("kn unchanged", localize_detailed("Please take a deposit slip.", "kn")[0] ==
          INSTRUCTIONS["Please take a deposit slip."]["kn"])
    check("hi unchanged", localize_detailed("Please take a deposit slip.", "hi")[0] ==
          INSTRUCTIONS["Please take a deposit slip."]["hi"])
    check("en unchanged", localize_detailed("Please take a deposit slip.", "en")[0] == "Please take a deposit slip.")
    check("other unsupported language unchanged", localize_detailed("Please take a deposit slip.", "ta") ==
          ("Please take a deposit slip.", UNSUPPORTED_LANGUAGE))


def test_speech_plan():
    print("\n[6] speech plan / voice selection")
    from app.speech.speech_plan import plan_speech
    from service.tts import plan_segments, select_voice
    from app.speech.tts import TextToSpeech

    voices = TextToSpeech.VOICES
    tulu = roman_to_kannada("Ait erna account number barele.")
    segs = plan_segments(f"{tulu} Let me know when you've completed it.", "tcy", voices)
    check("Kannada-script Tulu -> Kannada voice; English -> English voice",
          [v for _, v in segs] == [voices["kn"], voices["en"]], segs)
    check("tcy session voice resolves to the Kannada voice", select_voice("tcy", voices) == voices["kn"])
    check("kn plan unchanged", [s.language for s in plan_speech("ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ.", "kn")] == ["kn"])
    try:
        plan_speech("hello", "ta")
        check("unsupported session language still refused", False)
    except Exception:
        check("unsupported session language still refused", True)


def test_tts_module():
    print("\n[7] TTS module generates from text only")
    from app.tulu.tts.synthesizer import TuluSpeechSynthesizer, TuluTtsError, prepare_speech_text

    calls = []

    async def fake_generator(text, voice, path):
        calls.append((text, voice))
        with open(path, "wb") as fh:
            fh.write(b"ID3" + b"\x00" * 7 + b"\xff\xfb" + text.encode("utf-8"))

    opened = []
    real_open = builtins.open

    def spy_open(file, *a, **k):
        opened.append(str(file))
        return real_open(file, *a, **k)

    builtins.open = spy_open
    try:
        res = asyncio.run(TuluSpeechSynthesizer(fake_generator).synthesize("Ait erna account number barele."))
    finally:
        builtins.open = real_open
    check("generator received Kannada-script Tulu and the Kannada voice",
          calls == [("ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ.", "kn-IN-SapnaNeural")], calls)
    check("output is the generator's new audio", res.audio.startswith(b"ID3") and res.content_type == "audio/mpeg")
    check("no dataset recording was opened", not any("deposit conversation" in p for p in opened), opened)
    check("disclosure says not native Tulu TTS", "not a native Tulu TTS" in res.disclosure)
    prep = prepare_speech_text("ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ. Submit the slip along with the cash.")
    check("English fallback sentence is not transliterated",
          [k for _, _, k in prep.sentences] == ["tulu-kannada-script", "english"], prep.sentences)
    try:
        asyncio.run(TuluSpeechSynthesizer(fake_generator).synthesize("   "))
        check("empty text refused", False)
    except TuluTtsError as e:
        check("empty text refused", e.category == "empty_text")


def test_asr_wrapper():
    print("\n[8] ASR wrapper accepts only verified matches")
    from app.tulu.asr.recognizer import TuluSpeechRecognizer

    ok = TuluSpeechRecognizer(transcriber=lambda p: "ಯಂಕ್ ದುಡ್ಡು ಪಡೊಡು").recognize("x.wav")
    check("confident match accepted -> verified Romanized transcript",
          ok.accepted and ok.transcript == "Yank duddu padodu?", ok.as_dict())
    bad = TuluSpeechRecognizer(transcriber=lambda p: "painters").recognize("x.wav")
    check("weak match refused", not bad.accepted and bad.transcript is None)
    empty = TuluSpeechRecognizer(transcriber=lambda p: "").recognize("x.wav")
    check("empty acoustic output refused", not empty.accepted)


def test_withdrawal():
    print("\n[9] withdrawal dataset, intent, distinction, translation")
    import hashlib
    from app.tulu.data.dataset import audio_path
    from app.tulu.intent.matcher import AMBIGUOUS
    from app.dialogue.localization import TRANSLATED, localize_detailed

    w = load_dataset("withdrawal")
    utts = w["utterances"]
    check("withdrawal: 20 utterances (15 customer, 5 assistant), separate file from deposit",
          len(utts) == 20 and sum(u["speaker_role"] == "customer" for u in utts) == 15
          and all(u["dataset"] == "withdrawal" for u in utts)
          and all(u["dataset"] == "deposit" for u in load_dataset("deposit")["utterances"]))
    check("withdrawal steps equal withdraw.json",
          [w["step_instructions"][k]["text"] for k in "12345"] ==
          ["Please take a withdrawal slip.", "Fill in your account number.", "Enter the withdrawal amount.",
           "Sign the withdrawal slip.", "Submit the slip to the cashier."])
    check("groups follow the document tables (W03b->W04, W04a->W05)",
          {u["id"]: u["group"] for u in utts if u["id"] in ("W03a", "W03b", "W04a")} ==
          {"W03a": "W03", "W03b": "W04", "W04a": "W05"})
    check("W01b kept verbatim with 'kaas/amount'",
          next(u for u in utts if u["id"] == "W01b")["tulu_romanized"] ==
          "Yenk yenna account d dh kaas/amount deppere undu?")
    unchanged = all(hashlib.sha256(audio_path(u).read_bytes()).hexdigest() == u["audio"]["sha256"]
                    for u in utts + load_dataset("deposit")["utterances"])
    check("every original recording unchanged (SHA-256 equals dataset record)", unchanged)
    ids = {d["id"] for d in w["discrepancies"]}
    check("withdrawal discrepancies documented",
          {"NATIVE_SPEAKER_VERIFICATION_NOT_STATED", "FILENAMES_DIFFER_FROM_DOCUMENT",
           "W01B_ALTERNATIVE_WORDS", "CUSTOMER_IDS_VS_STEPS"} <= ids, ids)
    check("cross-dataset D03 'deppere' issue recorded in deposit discrepancies",
          any(d["id"] == "D03_DEPPERE_IN_DEPOSIT" for d in load_dataset("deposit")["discrepancies"]))

    from app.tulu.data.dataset import GROUPS as _G
    for u in (x for x in customer_utterances() if x["dataset"] == "withdrawal"):
        r = understand(u["tulu_romanized"])
        want = "withdraw" if u["group"] == "W01" else None
        # Same MEANING (pivot) as the annotated group. W03b1 'amount n bareye' is the
        # same sentence as deposit D04b and may match it: same meaning, same pivot.
        check(f"{u['id']} '{u['tulu_romanized']}' -> meaning of {u['group']} (intent {want})",
              r.accepted and r.pivot_en == _G[u["group"]]["pivot_en"] and r.intent_id == want,
              (r.method, r.group, r.intent_id, r.score))
    added = {"W02b", "W02c", "W02d", "W03a1", "W03b1", "W03b2", "W04b", "W04c"}
    check("the 8 added withdrawal phrases are present and grouped by their tables",
          {u["id"]: u["group"] for u in utts if u["id"] in added} ==
          {"W02b": "W02", "W02c": "W02", "W02d": "W02", "W03a1": "W03", "W03b1": "W04",
           "W03b2": "W04", "W04b": "W05", "W04c": "W05"})
    starts = [understand(u["tulu_romanized"]) for u in customer_utterances() if u["group"] == "W01"]
    check("three different W01 phrasings all -> withdraw / 'withdraw money'",
          len(starts) == 3 and all(r.intent_id == "withdraw" and r.intent == "withdraw money" for r in starts))
    check("Kannada-script withdrawal phrase -> withdraw",
          understand("ಯೆಂಕ್ ಕಾಸ್ ದೆಪ್ಪೆರೆ ಉಂಡು?").intent_id == "withdraw")

    # Distinction and rejection. These probes are CONSTRUCTED test inputs, not verified Tulu.
    check("deposit start never -> withdraw", all(understand(u["tulu_romanized"]).intent_id == "deposit"
                                                 for u in customer_utterances() if u["group"] == "D01"))
    r = understand("Yank duddu deppere undu?")
    check("probe: deposit-like spelling + withdrawal verb rejected as ambiguous", r.method == AMBIGUOUS, r.reason)
    r = understand("Yenk kaas padare undu?")
    check("probe: withdrawal-like spelling + deposit verb rejected as ambiguous", r.method == AMBIGUOUS, r.reason)
    r = understand("Yenk kaas padodu deppere?")
    check("probe: both service verbs rejected as ambiguous", r.method == AMBIGUOUS and r.pivot_en is None)
    r = understand("Yenk withdraw malpodu")
    check("probe: Tulu with loanword 'withdraw' -> withdraw via verified cue",
          r.accepted and r.intent_id == "withdraw" and r.method == "verified_keyword_cue")
    r = understand("Yank loan bodu")
    check("probe: unsupported (loan) not accepted as Tulu intent", not r.accepted and r.intent is None)
    r = understand("qwerty zzz")
    check("probe: unrelated text not accepted", not r.accepted)
    check("progress phrases have workflow-neutral pivots",
          all("deposit" not in understand(u["tulu_romanized"]).pivot_en.lower()
              and "withdraw" not in understand(u["tulu_romanized"]).pivot_en.lower()
              for u in customer_utterances() if understand(u["tulu_romanized"]).role == "progress"))

    cov = renderer.coverage("withdraw")
    check("withdrawal: all 5 steps have verified Tulu", list(cov.values()) == ["verified"] * 5, cov)
    check("no conflicting renderings across datasets", renderer.conflicts() == {})
    check("'Fill in your account number.' shared by D02 and W02 identically",
          renderer.verified_renderings()["Fill in your account number."].source_id == "D02+W02")
    for english, wid in [("Please take a withdrawal slip.", "W01"), ("Enter the withdrawal amount.", "W03"),
                         ("Sign the withdrawal slip.", "W04"), ("Submit the slip to the cashier.", "W05")]:
        romanized = next(u["tulu_romanized"] for u in utts if u["id"] == wid)
        text, status = localize_detailed(english, "tcy")
        check(f"tcy '{english}' -> verified {wid} (Kannada script)",
              status == TRANSLATED and text == roman_to_kannada(romanized), text)
    check("slip-g suffix attached", roman_to_kannada("Withdrawal slip-g sign malpule.") == "ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ.")

    from app.tulu.tts.synthesizer import TuluSpeechSynthesizer
    calls = []

    async def gen(text, voice, path):
        calls.append((text, voice))
        with open(path, "wb") as fh:
            fh.write(b"ID3" + b"\x00" * 7 + text.encode("utf-8"))

    tulu_reply = localize_detailed("Sign the withdrawal slip.", "tcy")[0]
    res = asyncio.run(TuluSpeechSynthesizer(gen).synthesize(tulu_reply))
    check("TTS generated from translated withdrawal text with the Kannada voice",
          calls == [(tulu_reply, "kn-IN-SapnaNeural")] and res.audio.startswith(b"ID3"), calls)


def test_control():
    print("\n[10] conversation-control dataset and matching")
    import hashlib
    from app.dialogue.manager import classify_command
    from app.tulu.data.dataset import CONTROL_INTENTS, GROUPS, audio_path
    from app.tulu.intent.matcher import AMBIGUOUS, LOW_CONFIDENCE, PASSTHROUGH, VERIFIED_MATCH

    c = load_dataset("control")
    utts = c["utterances"]
    check("control: 28 statements (22 customer incl. 1 text-only, 6 assistant), own file, no workflow",
          len(utts) == 28 and sum(u["speaker_role"] == "customer" for u in utts) == 22
          and c["workflow"] is None and all(u["dataset"] == "control" for u in utts))
    check("every row: verification 'not stated', kannada_script null, gloss kept",
          all(u["verification"] == "not stated" and u["kannada_script"] is None and u["english_meaning"] for u in utts))
    check("control recordings unchanged (SHA-256)",
          all(hashlib.sha256(audio_path(u).read_bytes()).hexdigest() == u["audio"]["sha256"]
              for u in utts if u.get("audio_file")))
    t1 = next(u for u in utts if u["id"] == "C04t1")
    check("text-only 'yank gothuji' stored verbatim, no audio, marked text_only with its source",
          t1["tulu_romanized"] == "yank gothuji" and t1["english_meaning"] == "I don't know."
          and t1["audio_file"] is None and t1.get("text_only") is True and "chat" in t1["source"]
          and "audio" not in t1)
    from app.tulu.data.dataset import audio_utterances
    check("text-only rows are never treated as recordings", all(u.get("audio_file") for u in audio_utterances())
          and "C04t1" not in {u["id"] for u in audio_utterances()})
    r = understand("yank gothuji")
    check("'yank gothuji' (I don't know) -> CLARIFY_CURRENT_STEP, no service intent",
          r.method == VERIFIED_MATCH and r.control == "CLARIFY_CURRENT_STEP" and r.intent is None
          and r.pivot_en == "help", (r.method, r.control, r.score))
    r = understand("Yank gothuji?")
    check("'Yank gothuji?' (capital, question mark) -> same control", r.control == "CLARIFY_CURRENT_STEP")
    check("C02d kept verbatim", next(u for u in utts if u["id"] == "C02d")["tulu_romanized"] ==
          "Yaan panpina muta continue malporchi")
    check("C03 = stop, recorded as a team decision (native confirmation pending)",
          GROUPS["C03"]["pivot_en"] == "stop" and "team" in GROUPS["C03"].get("mapping_decided_by", "")
          and "team" in c["control_groups"]["C03"]["mapping_confidence"])
    check("implemented controls are exactly the six the dataset covers",
          set(CONTROL_INTENTS) == {"REPEAT_STEP", "PAUSE_WORKFLOW", "STOP_REQUEST", "CLARIFY_CURRENT_STEP",
                                   "NEXT_STEP", "RESUME_WORKFLOW"})
    check("each control pivot is an EXISTING deterministic engine command (stop = engine cancel)",
          {k: classify_command(v) for k, v in CONTROL_INTENTS.items()} ==
          {"REPEAT_STEP": "repeat", "PAUSE_WORKFLOW": "pause", "STOP_REQUEST": "cancel",
           "CLARIFY_CURRENT_STEP": "help", "NEXT_STEP": "next", "RESUME_WORKFLOW": "resume"})
    check("no PREVIOUS_STEP control (no Tulu data, no engine command)", "PREVIOUS_STEP" not in CONTROL_INTENTS)
    r6, r2 = understand("Continue malpule"), understand("Yaan panpina muta continue malporchi")
    check("C06 'Continue malpule' -> resume, while C02d (don't continue) -> pause",
          r6.control == "RESUME_WORKFLOW" and r6.pivot_en == "resume" and r2.control == "PAUSE_WORKFLOW")

    want = {"C01": "REPEAT_STEP", "C02": "PAUSE_WORKFLOW", "C03": "STOP_REQUEST", "C04": "CLARIFY_CURRENT_STEP",
            "C05": "NEXT_STEP", "C06": "RESUME_WORKFLOW"}
    for u in (x for x in utts if x["speaker_role"] == "customer"):
        r = understand(u["tulu_romanized"])
        check(f"{u['id']} '{u['tulu_romanized']}' -> {want[u['group']]}, no service intent",
              r.method == VERIFIED_MATCH and r.control == want[u["group"]] and r.intent is None
              and r.intent_id is None and r.role == "control", (r.method, r.control, r.intent_id))
    r = understand("Yaan panpina muta continue malporchi")
    check("C02d ('don't continue') -> pause, never the engine's 'continue' (resume)",
          r.pivot_en == "pause" and classify_command(r.pivot_en) == "pause")
    for u in customer_utterances():
        if u["dataset"] in ("deposit", "withdrawal"):
            assert understand(u["tulu_romanized"]).control is None
    check("no deposit/withdrawal phrase is classified as a control", True)
    check("deposit/withdrawal start phrases still -> service intents",
          all(understand(u["tulu_romanized"]).intent_id in ("deposit", "withdraw")
              for u in customer_utterances() if u["group"] in ("D01", "W01")))

    # Constructed probes (not dataset phrases).
    r = understand("Kuda panoli ya deppere")
    check("probe: control phrase + service verb rejected as ambiguous", r.method == AMBIGUOUS, r.reason)
    r = understand("churu wait")
    check("probe: near-miss Tulu (0.69) rejected as low confidence, not guessed",
          r.method == LOW_CONFIDENCE and r.pivot_en is None, (r.method, r.score))
    r = understand("Kuda panoli")
    check("probe: truncated C01a still -> REPEAT_STEP (0.88)", r.control == "REPEAT_STEP")
    r = understand("Kuda explain")
    check("probe: fragment between repeat (C01a) and explain (C04b) not accepted", not r.accepted, (r.method, r.score))
    r = understand("continue")
    check("English 'continue' is not a Tulu match (passes to the engine unchanged)",
          r.method == PASSTHROUGH and r.pivot_en == "continue")

    acks = renderer.control_acknowledgements()
    check("one Tulu acknowledgement per control group (C01-C06)",
          sorted(acks) == ["C01", "C02", "C03", "C04", "C05", "C06"])
    check("C05/C06 replies kept verbatim",
          acks["C05"].tulu_romanized == "Avu next dada malpodu annd panpe."
          and acks["C06"].tulu_romanized == "Avu erna request n continue malpuve.")
    check("doubled nasal before a stop is one anusvara ('annd' -> ಅಂಡ್)",
          roman_to_kannada("Avu next dada malpodu annd panpe.") == "ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ."
          and "್ಂ" not in "".join(a.tulu_kannada for a in acks.values()))
    check("acknowledgements keep the Romanized text verbatim",
          acks["C04"].tulu_romanized == "Thondre ejji yaan ereg kuda panpe..")
    check("acknowledgements say verification is not stated", all("not stated" in a.review_status for a in acks.values()))
    check("control replies are not used as workflow-step renderings",
          all(r.source_id[0] in "DW" for r in renderer.verified_renderings().values()))

    from app.tulu.tts.synthesizer import TuluSpeechSynthesizer
    calls = []

    async def gen(text, voice, path):
        calls.append((text, voice))
        with open(path, "wb") as fh:
            fh.write(b"ID3" + b"\x00" * 7 + text.encode("utf-8"))

    for group, ack in acks.items():
        calls.clear()
        res = asyncio.run(TuluSpeechSynthesizer(gen).synthesize(ack.tulu_kannada))
        check(f"TTS generated from the {group} acknowledgement text (Kannada voice)",
              calls and all(v == "kn-IN-SapnaNeural" for _, v in calls) and res.audio.startswith(b"ID3"), calls)


def test_pivots_step_specific():
    print("\n[11] progress pivots are confirmed deterministically ONLY at their own step")
    import json
    from pathlib import Path
    from app.dialogue.completion_semantics import resolve_step_completion
    from app.tulu.data.dataset import GROUPS

    wf_dir = Path(__file__).resolve().parents[2] / "workflow" / "workflows"
    steps = {w: [s["instruction"] for s in json.loads((wf_dir / f"{w}.json").read_text(encoding="utf-8"))["steps"]]
             for w in ("deposit", "withdraw")}
    # pivot -> the step (1-based) it completes in each workflow; None = no such step.
    expected = {
        "I have taken the slip.": {"deposit": 1, "withdraw": 1},
        "I have filled in the account number.": {"deposit": 2, "withdraw": 2},
        "I have entered the amount.": {"deposit": 3, "withdraw": 3},
        "I have signed the slip.": {"deposit": None, "withdraw": 4},
    }
    used = {g["pivot_en"] for g in GROUPS.values() if g["role"] == "progress"}
    check("every progress pivot is covered by this test", used == set(expected), used)
    for pivot, where in expected.items():
        for wf, instrs in steps.items():
            confirmed = [i + 1 for i, ins in enumerate(instrs) if resolve_step_completion(pivot, ins) is True]
            want = [where[wf]] if where[wf] else []
            check(f"'{pivot}' confirmed in {wf} only at step {want}", confirmed == want, confirmed)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    for test in (test_dataset, test_normalization, test_transliteration, test_understanding,
                 test_translation, test_speech_plan, test_tts_module, test_asr_wrapper, test_withdrawal,
                 test_control, test_pivots_step_specific):
        test()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    for f in FAILED:
        print("  FAILED:", f)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
