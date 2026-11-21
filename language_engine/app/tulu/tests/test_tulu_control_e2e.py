"""
TULU CONVERSATION-CONTROL END-TO-END -- real FastAPI service, real engine.

For every control statement (15 customer phrases, C01-C04), inside a fresh
deposit or withdrawal visit:

  spoken:  recording --/turn/audio--> Tulu ASR (IndicConformer-kn + closed
           set) --> control --> EXISTING deterministic control action
           (repeat / pause / thanks / help) --> Tulu acknowledgement + engine
           reply --/tts--> NEWLY GENERATED audio
  typed:   the same phrase as text

Checks the effect on the workflow (pause suspends; repeat/clarify/decline do
not move it), that the reply starts with the group's Tulu acknowledgement,
that every reply is synthesized fresh (never a dataset recording), and that
NO LLM call is made (these paths are deterministic, so the Groq quota is not
touched). Start phrases are deterministic too.

Run from language_engine/:
    python -m app.tulu.tests.test_tulu_control_e2e
Writes evaluation/reports/tulu_control_e2e.json and .md.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import time
import uuid
from contextlib import redirect_stdout

from app.tulu.data.dataset import all_utterances, audio_path, audio_utterances, load_dataset
from app.tulu.evaluation.asr_eval import REPORTS, available_memory_mb, memory_mb
from app.tulu.evaluation.tts_eval import decode_16k, peak_xcorr
from app.tulu.translation.renderer import control_acknowledgements, verified_renderings

PASSED, FAILED, LOG = [], [], []
MIN_FREE_MB = 600


def check(label, condition, detail=""):
    (PASSED if condition else FAILED).append(label)
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{(' -- ' + str(detail)) if detail and not condition else ''}",
          flush=True)
    LOG.append({"check": label, "passed": bool(condition), "detail": str(detail)})


STARTS = {"deposit": ("Yank duddu padodu?", "Please take a deposit slip.", "deposit money"),
          "withdraw": ("Yenk kaas deppere undu?", "Please take a withdrawal slip.", "withdraw money")}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    free = available_memory_mb()
    print(f"free RAM before: {free} MB", flush=True)
    if free < MIN_FREE_MB:
        print(f"stopped cleanly: free RAM {free} MB < {MIN_FREE_MB} MB")
        return 2

    from fastapi.testclient import TestClient
    import service.main as main_mod

    acks = control_acknowledgements()
    tulu = {e: r.tulu_kannada for e, r in verified_renderings().items()}
    dataset_hashes = {u["audio"]["sha256"] for u in audio_utterances()}
    controls = [u for u in load_dataset("control")["utterances"] if u["speaker_role"] == "customer"]
    headers = {"X-Internal-Token": main_mod.INTERNAL_TOKEN} if main_mod.INTERNAL_TOKEN else {}
    rows = []

    log = io.StringIO()
    with redirect_stdout(log):
        client = TestClient(main_mod.app, raise_server_exceptions=False)
        client.__enter__()

    def post(path, **kw):
        with redirect_stdout(log):
            return client.post(path, headers=headers, **kw)

    for mode in ("speech", "typed"):
        print(f"\n[{mode}] control statements inside a live workflow", flush=True)
        for i, u in enumerate(controls):
            if mode == "speech" and not u.get("audio_file"):
                continue   # text-only phrase (control_supplement.json): typed path only
            workflow = "deposit" if i % 2 == 0 else "withdraw"
            start_text, step1_en, wf_name = STARTS[workflow]
            session = f"tulu-ctl-{uuid.uuid4().hex[:8]}"
            start = post("/turn", json={"session_id": session, "language": "tcy", "text": start_text}).json()
            row = {"mode": mode, "id": u["id"], "control": u["canonical_control"], "workflow": workflow}
            started = time.perf_counter()
            if mode == "speech":
                path = audio_path(u)
                r = post("/turn/audio", data={"session_id": session, "language": "tcy"},
                         files={"audio": (path.name, path.read_bytes(), "application/octet-stream")})
                if r.status_code == 200:
                    body = r.json()
                    row.update(input="speech", transcript=body["transcript"])
                else:
                    row.update(input="typed fallback after ASR refusal", asr_refusal=r.json().get("detail"))
                    body = post("/turn", json={"session_id": session, "language": "tcy",
                                               "text": u["tulu_romanized"]}).json()
            else:
                body = post("/turn", json={"session_id": session, "language": "tcy", "text": u["tulu_romanized"]}).json()
                row["input"] = "typed"
            row.update(latency_s=round(time.perf_counter() - started, 2), reply=body["reply"],
                       state=body["workflow"]["state"], step=body["workflow"]["step"], intent=body.get("intent"))

            ack = acks[u["group"]].tulu_kannada
            step1 = tulu[step1_en]
            label = f"{mode} {u['id']} '{u['tulu_romanized']}' ({workflow})"
            ok_common = (start["reply"] == step1 and body["reply"].startswith(ack)
                         and body.get("intent") == u["canonical_control"]
                         and body["workflow"]["name"] == wf_name and not body.get("ended"))
            # Situational replies (CONTROL_REPLY_PLAN): Tulu reply + what the
            # situation needs, from each reply's English meaning.
            at_step1 = row["state"] == "active" and row["step"] == 1
            control = u["canonical_control"]
            if control in ("REPEAT_STEP", "NEXT_STEP", "RESUME_WORKFLOW"):
                ok = ok_common and body["reply"] == f"{ack} {step1}" and at_step1
            elif control == "PAUSE_WORKFLOW":
                ok = ok_common and body["reply"] == ack and row["state"] == "suspended"
            elif control == "CLARIFY_CURRENT_STEP":
                ok = ok_common and body["reply"].endswith(step1) and body["reply"] != f"{ack} {step1}" and at_step1
            else:  # STOP_REQUEST -> cancelled at once + exit offer; a 2nd stop ends the conversation
                cancelled = (body["reply"] == f"{ack} Say stop again to end the conversation."
                             and body["workflow"]["state"] == "cancelled" and not body.get("ended")
                             and body.get("intent") == u["canonical_control"] and start["reply"] == step1)
                second = post("/turn", json={"session_id": session, "language": "tcy",
                                             "text": u["tulu_romanized"]}).json()
                ok = cancelled and second.get("ended") is True and second.get("intent") == "EXIT_CONVERSATION"
                row["second_reply"], row["second_ended"] = second["reply"], second.get("ended")
            check(f"{label} -> {u['canonical_control']}: correct engine action and Tulu acknowledgement", ok,
                  f"reply={body['reply']!r} state={row['state']} step={row['step']} intent={body.get('intent')}")
            if row.get("transcript") is not None:
                check(f"  {u['id']}: ASR transcript is a verified control phrase of the same group",
                      any(v["tulu_romanized"] == row["transcript"] and v["group"] == u["group"]
                          for v in controls), row["transcript"])

            s = post("/tts", json={"text": body["reply"], "language": "tcy"})
            row["tts_status"] = s.status_code
            if s.status_code == 200:
                digest = hashlib.sha256(s.content).hexdigest()
                # Text-only phrases have no input recording to compare against;
                # the SHA-256 check against every recording still applies.
                xc = peak_xcorr(decode_16k(s.content), decode_16k(audio_path(u))) if u.get("audio_file") else 0.0
                row.update(tts_bytes=len(s.content), xcorr_vs_input=round(xc, 3) if u.get("audio_file") else None)
                check(f"  {u['id']}: reply newly synthesized (MP3, not a dataset recording, xcorr {xc:.3f} < 0.5)",
                      s.headers.get("content-type") == "audio/mpeg" and digest not in dataset_hashes and xc < 0.5)
            else:
                check(f"  {u['id']}: /tts produced audio", False, s.text[:200])
            rows.append(row)

    print("\n[situational] the reply follows the workflow state", flush=True)
    s2 = f"tulu-ctl-{uuid.uuid4().hex[:8]}"

    def turn_(text):
        return post("/turn", json={"session_id": s2, "language": "tcy", "text": text}).json()

    turn_("Yank duddu padodu?")
    turn_("Slip dethond aand?")                      # deposit step 1 done -> step 2
    paused = turn_("Churu wait malpule")
    body = turn_("Next panle")
    step2 = tulu["Fill in your account number."]
    check("deposit paused at step 2, 'Next panle' -> C05 reply + step 2 (not step 3), workflow resumed",
          paused["workflow"]["state"] == "suspended" and body["reply"] == f"{acks['C05'].tulu_kannada} {step2}"
          and body["workflow"]["state"] == "active" and body["workflow"]["step"] == 2, body)
    s2 = f"tulu-ctl-{uuid.uuid4().hex[:8]}"
    for text in ("Yenk kaas deppere undu?", "yan slip dethonde.", "account number bareye."):
        turn_(text)                                  # withdrawal -> step 3
    turn_("Yaan panpina muta unthule")               # pause
    body = turn_("Olpa unthayar alpa d continue malpule")
    step3 = tulu["Enter the withdrawal amount."]
    check("withdrawal paused at step 3, C06 continue -> C06 reply + step 3, resumed",
          body["reply"] == f"{acks['C06'].tulu_kannada} {step3}" and body["workflow"]["state"] == "active"
          and body["workflow"]["step"] == 3, body)
    body = turn_("Undu ayii bokka dada")
    check("C05 while active at step 3 -> C05 reply + step 3 (next never skips an unfinished step)",
          body["reply"] == f"{acks['C05'].tulu_kannada} {step3}" and body["workflow"]["step"] == 3, body)
    body = turn_("Aven kuda panle")
    check("C01 repeat at step 3 -> C01 reply + step 3", body["reply"] == f"{acks['C01'].tulu_kannada} {step3}", body)
    s3 = f"tulu-ctl-{uuid.uuid4().hex[:8]}"
    for text in ("Next dada", "Continue malpule", "Kuda panoli ya"):
        body = post("/turn", json={"session_id": s3, "language": "tcy", "text": text}).json()
        check(f"'{text}' with nothing active -> engine's own message, no contradictory Tulu reply",
              not any(body["reply"].startswith(a.tulu_kannada) for a in acks.values())
              and body["workflow"]["name"] is None, body["reply"])

    print("\n[safety]", flush=True)
    s = f"tulu-ctl-{uuid.uuid4().hex[:8]}"
    body = post("/turn", json={"session_id": s, "language": "tcy", "text": "Yaan panpina muta continue malporchi"}).json()
    check("C02d with no workflow: no workflow started (never read as a service or as resume)",
          body["workflow"]["name"] is None, body)
    body = post("/turn", json={"session_id": s, "language": "tcy", "text": "Kuda panoli ya"}).json()
    check("repeat with nothing active: no contradictory acknowledgement",
          not body["reply"].startswith(acks["C01"].tulu_kannada), body["reply"])
    body = post("/turn", json={"session_id": s, "language": "tcy", "text": "churu wait"}).json()
    check("near-miss Tulu -> 'please say it again, or type it' (clarify), nothing started",
          body["outcome"] == "clarify" and body["workflow"]["name"] is None, body)

    llm_lines = [line for line in log.getvalue().splitlines() if "[LLM]" in line or "llm_understand=" in line]
    check("no LLM call was made by any control or start turn", not llm_lines, llm_lines[:3])
    mem = memory_mb()
    with redirect_stdout(log):
        client.__exit__(None, None, None)

    spoken = [r for r in rows if r["mode"] == "speech"]
    summary = {"passed": len(PASSED), "failed": len(FAILED), "failures": FAILED,
               "spoken_recognised": f"{sum(r['input'] == 'speech' for r in spoken)}/{len(spoken)}",
               "llm_calls": len(llm_lines), "memory_end": mem}
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "tulu_control_e2e.json").write_text(json.dumps({"summary": summary, "checks": LOG, "rows": rows},
                                                              ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Tulu conversation-control end-to-end", "", f"Passed {len(PASSED)}, failed {len(FAILED)}. "
             f"Spoken phrases recognised by ASR: {summary['spoken_recognised']}. LLM calls: {len(llm_lines)}.", "",
             "| Mode | ID | Control | Workflow | Input | ASR transcript | Reply | State/step | TTS | xcorr | Latency |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['mode']} | {r['id']} | {r['control']} | {r['workflow']} | {r['input']} | "
                     f"{r.get('transcript') or '—'} | {r['reply']} | {r['state']}/{r['step']} | {r['tts_status']} | "
                     f"{r.get('xcorr_vs_input', '-')} | {r['latency_s']} s |")
    lines += ["", "## Checks", ""] + [f"- {'PASS' if c['passed'] else 'FAIL'} {c['check']}" for c in LOG]
    (REPORTS / "tulu_control_e2e.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed; spoken recognised {summary['spoken_recognised']}; "
          f"LLM calls {len(llm_lines)}", flush=True)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
