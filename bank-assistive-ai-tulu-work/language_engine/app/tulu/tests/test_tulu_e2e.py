"""
TULU END-TO-END -- through the real FastAPI service and the real engine.

  Tulu audio --/turn/audio--> Tulu ASR (IndicConformer-kn + closed-set match)
  --> verified Tulu text --> English pivot --> EXISTING intent detector /
  dialogue manager / deposit.json or withdraw.json --> verified Tulu
  rendering --/tts--> NEWLY GENERATED audio (Kannada-trained voice)

Deposit and withdrawal are run SEPARATELY. When ASR refuses a recording the
customer's typed Tulu is used instead (the documented fallback) and the
report says so. Also: typed-Tulu sequences for every verified customer
utterance, ambiguity rejection, the English fallback for intents without
verified Tulu, and English/Kannada regressions on the same service.

Needs cached models and network access for Edge TTS. Recordings are read in
place, read-only.

Run from language_engine/:
    python -m app.tulu.tests.test_tulu_e2e
Writes evaluation/reports/tulu_e2e.json and tulu_e2e.md.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import time
import uuid
from contextlib import redirect_stdout

from app.tulu.data.dataset import all_utterances, audio_path, audio_utterances, load_dataset, step_text
from app.tulu.evaluation.asr_eval import REPORTS, available_memory_mb, memory_mb
from app.tulu.evaluation.tts_eval import decode_16k, peak_xcorr
from app.tulu.translation.renderer import verified_renderings

PASSED, FAILED, LOG = [], [], []


def check(label, condition, detail=""):
    (PASSED if condition else FAILED).append(label)
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{(' -- ' + str(detail)) if detail and not condition else ''}",
          flush=True)
    LOG.append({"check": label, "passed": bool(condition), "detail": str(detail)})


AUDIO_SEQUENCES = {
    "deposit": [["D01a", "D02a", "D03a", "D04a"], ["D01b", "D02b", "D03b", "D04b"],
                ["D01c", "D02c", "D03a", "D04c"], ["D01c", "D02d", "D03b", "D04a"]],
    "withdraw": [["W01a", "W02a", "W03a", "W03b", "W04a"], ["W01b", "W02a", "W03a", "W03b", "W04a"],
                 ["W01c", "W02a", "W03a", "W03b", "W04a"],
                 # phrases added 2026-11-19 (second speaker)
                 ["W01b", "W02b", "W03a1", "W03b1", "W04b"], ["W01c", "W02c", "W03a1", "W03b2", "W04c"],
                 ["W01a", "W02d", "W03a1", "W03b2", "W04b"]],
}
TYPED_SEQUENCES = {
    "deposit": [["D01a", "D02b", "D03b", "D04b"], ["D01b", "D02c", "D03a", "D04c"],
                ["D01c", "D02d", "D03a", "D04a"], ["D01a", "D02a", "D03b", "D04a"]],
    "withdraw": [["W01a", "W02a", "W03a", "W03b", "W04a"], ["W01b", "W02a", "W03a", "W03b", "W04a"],
                 ["W01c", "W02a", "W03a", "W03b", "W04a"],
                 ["W01a", "W02b", "W03a1", "W03b1", "W04b"], ["W01c", "W02c", "W03a1", "W03b2", "W04c"],
                 ["W01b", "W02d", "W03a", "W03b2", "W04b"]],
}
WORKFLOW_NAMES = {"deposit": "deposit money", "withdraw": "withdraw money"}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    from fastapi.testclient import TestClient
    import service.main as main_mod

    print(f"free RAM before: {available_memory_mb()} MB", flush=True)
    by_id = {u["id"]: u for u in all_utterances()}
    tulu_for = {e: r.tulu_kannada for e, r in verified_renderings().items()}

    def expected_reply(utt):
        english = step_text(utt)
        return tulu_for.get(english, english)

    dataset_hashes = {u["audio"]["sha256"] for u in audio_utterances()}
    assistant_hashes = {u["audio"]["sha256"] for u in audio_utterances() if u["speaker_role"] == "assistant"}
    headers = {"X-Internal-Token": main_mod.INTERNAL_TOKEN} if main_mod.INTERNAL_TOKEN else {}
    record = {"audio_runs": [], "typed_runs": [], "rejections": [], "fallbacks": [], "regressions": []}

    quiet = io.StringIO()
    t0 = time.perf_counter()
    with redirect_stdout(quiet):
        client = TestClient(main_mod.app, raise_server_exceptions=False)
        client.__enter__()          # runs the lifespan: loads the real engine
    record["engine_start_s"] = round(time.perf_counter() - t0, 1)

    def turn(session, text, language="tcy"):
        with redirect_stdout(quiet):
            return client.post("/turn", json={"session_id": session, "language": language, "text": text},
                               headers=headers)

    def tts(text, language="tcy"):
        with redirect_stdout(quiet):
            return client.post("/tts", json={"text": text, "language": language}, headers=headers)

    for workflow in ("deposit", "withdraw"):
        # --------------------------------------------------------------
        print(f"\n[{workflow}] audio -> ASR -> intent -> workflow -> Tulu -> generated speech", flush=True)
        for seq in AUDIO_SEQUENCES[workflow]:
            session = f"tulu-audio-{uuid.uuid4().hex[:8]}"
            run = {"workflow": workflow, "sequence": seq, "turns": []}
            for uid in seq:
                u = by_id[uid]
                path = audio_path(u)
                started = time.perf_counter()
                with redirect_stdout(quiet):
                    r = client.post("/turn/audio", data={"session_id": session, "language": "tcy"},
                                    files={"audio": (path.name, path.read_bytes(), "application/octet-stream")},
                                    headers=headers)
                entry = {"id": uid, "status": r.status_code, "turn_latency_s": round(time.perf_counter() - started, 2)}
                if r.status_code == 200:
                    body = r.json()
                    entry.update(transcript=body["transcript"], reply=body["reply"], workflow=body["workflow"],
                                 input_mode="speech")
                else:
                    entry["asr_refusal"] = r.json().get("detail")
                    body = turn(session, u["tulu_romanized"]).json()
                    entry.update(transcript=None, reply=body["reply"], workflow=body["workflow"],
                                 input_mode="typed fallback after ASR refusal")
                check(f"{workflow} audio {'-'.join(seq)}: {uid} ({entry['input_mode']}) -> step {u['step']}",
                      entry["reply"] == expected_reply(u) and entry["workflow"]["step"] == u["step"]
                      and entry["workflow"]["name"] == WORKFLOW_NAMES[workflow],
                      f"reply={entry['reply']!r} workflow={entry['workflow']}")
                if entry["transcript"] is not None:
                    check(f"  {uid}: accepted transcript is a verified utterance with the same meaning",
                          any(v["tulu_romanized"] == entry["transcript"] for v in all_utterances()), entry["transcript"])

                s = tts(entry["reply"])
                audio = s.content
                entry.update(tts_status=s.status_code, tts_bytes=len(audio))
                if s.status_code == 200:
                    digest = hashlib.sha256(audio).hexdigest()
                    xc = peak_xcorr(decode_16k(audio), decode_16k(path))
                    entry.update(tts_sha256=digest, xcorr_vs_input_recording=round(xc, 3))
                    check(f"  {uid}: /tts returned newly generated MP3",
                          s.headers.get("content-type") == "audio/mpeg" and len(audio) > 1000)
                    check(f"  {uid}: generated audio is not any dataset recording (SHA-256)",
                          digest not in dataset_hashes and digest not in assistant_hashes)
                    check(f"  {uid}: generated audio is not the input recording (xcorr {xc:.3f} < 0.5)", xc < 0.5)
                else:
                    check(f"  {uid}: /tts returned audio", False, f"status {s.status_code} {s.text[:200]}")
                run["turns"].append(entry)
            record["audio_runs"].append(run)

        # --------------------------------------------------------------
        print(f"\n[{workflow}] typed Tulu: every verified customer utterance through the workflow", flush=True)
        for seq in TYPED_SEQUENCES[workflow]:
            session = f"tulu-text-{uuid.uuid4().hex[:8]}"
            for uid in seq:
                u = by_id[uid]
                body = turn(session, u["tulu_romanized"]).json()
                ok = (body["reply"] == expected_reply(u) and body["workflow"]["step"] == u["step"]
                      and body["workflow"]["name"] == WORKFLOW_NAMES[workflow])
                check(f"{workflow} typed {uid} '{u['tulu_romanized']}' -> step {u['step']}", ok,
                      f"reply={body['reply']!r} workflow={body['workflow']}")
                record["typed_runs"].append({"workflow": workflow, "id": uid, "reply": body["reply"],
                                             "workflow_state": body["workflow"]})

    # ------------------------------------------------------------------
    print("\n[distinction] deposit vs withdrawal, ambiguity, mid-workflow progress phrases", flush=True)
    s = f"tulu-x-{uuid.uuid4().hex[:8]}"
    turn(s, by_id["W01a"]["tulu_romanized"])
    body = turn(s, by_id["D02a"]["tulu_romanized"]).json()   # deposit-set progress phrase in a withdrawal
    check("deposit-set progress phrase advances a WITHDRAWAL visit (neutral pivot), no conflict",
          body["workflow"]["name"] == "withdraw money" and body["workflow"]["step"] == 2, body)
    s = f"tulu-x-{uuid.uuid4().hex[:8]}"
    body = turn(s, "Yank duddu deppere undu?").json()           # constructed probe
    check("probe 'Yank duddu deppere undu?' rejected as ambiguous: clarification, no workflow started",
          body["outcome"] == "clarify" and body["workflow"]["state"] in ("none", None) or body["workflow"]["name"] is None,
          body)
    record["rejections"].append({"input": "Yank duddu deppere undu?", "reply": body["reply"], "workflow": body["workflow"]})
    body = turn(s, "Yenk kaas padodu deppere?").json()          # constructed probe
    check("probe with both service verbs rejected as ambiguous", body["outcome"] == "clarify", body)
    record["rejections"].append({"input": "Yenk kaas padodu deppere?", "reply": body["reply"]})

    # ------------------------------------------------------------------
    print("\n[fallback] intents and steps without verified Tulu", flush=True)
    s = f"tulu-fb-{uuid.uuid4().hex[:8]}"
    body = turn(s, "I want to apply for a loan").json()
    reply = body["reply"]
    check("loan in a Tulu session: existing workflow started", "loan" in (body["workflow"]["name"] or ""),
          body["workflow"])
    check("loan reply is English, not presented as Tulu", not any("ಀ" <= c <= "೿" for c in reply), reply)
    r = tts(reply)
    check("loan reply still spoken (English voice), 200", r.status_code == 200)
    record["fallbacks"].append({"case": "loan", "reply": reply, "workflow": body["workflow"]})
    s = f"tulu-fb-{uuid.uuid4().hex[:8]}"
    for uid in ("D01c", "D02a", "D03a", "D04a"):
        body = turn(s, by_id[uid]["tulu_romanized"]).json()
    check("deposit step 4 (disputed D04) answered in English", body["reply"] == "Submit the slip along with the cash.",
          body["reply"])
    record["fallbacks"].append({"case": "deposit step 4 (D04 disputed)", "reply": body["reply"]})

    # ------------------------------------------------------------------
    print("\n[regression] English and Kannada on the same service", flush=True)
    steps_d = load_dataset("deposit")["step_instructions"]
    steps_w = load_dataset("withdrawal")["step_instructions"]
    from app.dialogue.localization_catalog import INSTRUCTIONS
    body = turn(f"en-{uuid.uuid4().hex[:8]}", "I want to deposit money", "en").json()
    check("English deposit -> English step 1", body["reply"] == steps_d["1"]["text"], body["reply"])
    body = turn(f"en-{uuid.uuid4().hex[:8]}", "I want to withdraw money", "en").json()
    check("English withdraw -> English step 1", body["reply"] == steps_w["1"]["text"], body["reply"])
    body = turn(f"kn-{uuid.uuid4().hex[:8]}", "ನಾನು ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "kn").json()
    check("Kannada deposit -> Kannada catalog step 1 (not Tulu)",
          body["reply"] == INSTRUCTIONS[steps_d["1"]["text"]]["kn"], body["reply"])
    record["regressions"].append({"language": "kn", "reply": body["reply"]})
    r = tts("ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ.", "kn")
    check("Kannada /tts unchanged", r.status_code == 200 and r.headers.get("content-type") == "audio/mpeg")
    r = tts("hello", "ta")
    check("unsupported language still refused by /tts (400)", r.status_code == 400, r.status_code)

    print("\n[routes] /tulu", flush=True)
    with redirect_stdout(quiet):
        cap = client.get("/tulu/capabilities", headers=headers)
        tt = client.post("/tulu/tts", json={"text": "Withdrawal slip-g sign malpule."}, headers=headers)
        un = client.post("/tulu/understand", json={"text": "Yenk bank dh kaas deppere undu?"}, headers=headers)
    check("/tulu/capabilities lists deposit and withdraw",
          cap.status_code == 200 and set(cap.json()["supported_intents"]) == {"deposit", "withdraw"})
    check("/tulu/tts generated audio + disclosure header", tt.status_code == 200
          and "not a native Tulu TTS" in tt.headers.get("x-tulu-disclosure", ""))
    check("/tulu/understand W01c -> withdraw", un.status_code == 200 and un.json()["intent_id"] == "withdraw")

    record["memory_end"] = memory_mb()
    with redirect_stdout(quiet):
        client.__exit__(None, None, None)

    summary = {"passed": len(PASSED), "failed": len(FAILED), "failures": FAILED,
               "engine_start_s": record["engine_start_s"], "memory_end": record["memory_end"]}
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "tulu_e2e.json").write_text(json.dumps({"summary": summary, "checks": LOG, **record},
                                                      ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Tulu end-to-end results", "", f"Passed {len(PASSED)}, failed {len(FAILED)}.",
             f"Engine start {record['engine_start_s']} s; process memory at end {record['memory_end']}.", "",
             "## Audio runs", "",
             "| Workflow | Sequence | ID | Input mode | ASR transcript | Reply | Step | TTS | xcorr vs input | Turn latency |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for run in record["audio_runs"]:
        for t in run["turns"]:
            lines.append(f"| {run['workflow']} | {'-'.join(run['sequence'])} | {t['id']} | {t['input_mode']} | "
                         f"{t.get('transcript') or '—'} | {t['reply']} | {t['workflow']['step']} | "
                         f"{t.get('tts_status')} ({t.get('tts_bytes')} B) | {t.get('xcorr_vs_input_recording', '-')} | "
                         f"{t['turn_latency_s']} s |")
    lines += ["", "## All checks", ""] + [f"- {'PASS' if c['passed'] else 'FAIL'} {c['check']}" for c in LOG]
    (REPORTS / "tulu_e2e.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed", flush=True)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
