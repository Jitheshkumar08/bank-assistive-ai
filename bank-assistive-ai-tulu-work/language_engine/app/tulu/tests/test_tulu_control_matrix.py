"""
TULU CONTROL REPLIES -- EXHAUSTIVE SITUATION MATRIX (real service, real engine).

Every control phrase (21, C01-C06) is tried in every situation:

    workflow  : deposit (4 steps), withdrawal (5 steps)
    step      : every step of that workflow
    state     : active, paused
  + edge states: no workflow, completed workflow, cancelled workflow

and the reply and the workflow state are checked against the rule derived
from each group's English meaning (CONTROL_REPLY_PLAN):

    C01 repeat      -> Tulu reply + current step            step unchanged
    C02 wait/pause  -> Tulu reply only                       -> paused
    C03 stop        -> cancels at once: Tulu reply + exit offer; 2nd stop ends the conversation
    C04 clarify     -> Tulu reply + explanation + current step
    C05 what next   -> Tulu reply + current step             -> active, never skips
    C06 continue    -> Tulu reply + current step             -> active

"Current step" is rendered in verified Tulu where it exists, else English
(deposit step 4: wording disputed). No control may ever move the step.

Steps are reached with verified Tulu progress phrases (deterministic
completion, no LLM). Run with Groq made unavailable so no quota is used:

    GROQ_API_KEY=invalid-key-for-offline-test python -m app.tulu.tests.test_tulu_control_matrix

Writes evaluation/reports/tulu_control_matrix.json / .md.
"""

from __future__ import annotations

import io
import json
import sys
import uuid
from collections import Counter
from contextlib import redirect_stdout

from app.tulu.data.dataset import load_dataset
from app.tulu.evaluation.asr_eval import REPORTS, available_memory_mb
from app.tulu.translation.renderer import control_acknowledgements, verified_renderings

PASSED, FAILED, ROWS = [], [], []
EXIT_OFFER = "Say stop again to end the conversation."

WORKFLOWS = {
    # start phrase, progress phrases that complete steps 1..n-1, engine workflow name
    "deposit": ("Yank duddu padodu?", ["Slip dethond aand?", "Account number fill malthaand, nana dada malpodu?",
                                       "Amount n bareye."], "deposit money"),
    "withdraw": ("Yenk kaas deppere undu?", ["yan slip dethonde.", "account number bareye.", "amount n bareye",
                                              "sign padiye."], "withdraw money"),
}


def check(label, condition, detail=""):
    (PASSED if condition else FAILED).append(label)
    if not condition:
        print(f"  FAIL  {label} -- {detail}", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    free = available_memory_mb()
    print(f"free RAM before: {free} MB", flush=True)
    if free < 450:   # text-only: the speech recogniser is never loaded
        print("stopped cleanly: not enough free RAM")
        return 2

    from fastapi.testclient import TestClient
    import service.main as main_mod

    acks = {g: a.tulu_kannada for g, a in control_acknowledgements().items()}
    tulu = {e: r.tulu_kannada for e, r in verified_renderings().items()}
    steps = {"deposit": [load_dataset("deposit")["step_instructions"][str(i)]["text"] for i in range(1, 5)],
             "withdraw": [load_dataset("withdrawal")["step_instructions"][str(i)]["text"] for i in range(1, 6)]}
    controls = [u for u in load_dataset("control")["utterances"] if u["speaker_role"] == "customer"]
    headers = {"X-Internal-Token": main_mod.INTERNAL_TOKEN} if main_mod.INTERNAL_TOKEN else {}
    log = io.StringIO()
    with redirect_stdout(log):
        client = TestClient(main_mod.app, raise_server_exceptions=False)
        client.__enter__()

    def say(session, text):
        with redirect_stdout(log):
            return client.post("/turn", json={"session_id": session, "language": "tcy", "text": text},
                               headers=headers).json()

    def expected_reply(group, instruction, reply):
        step_text = tulu.get(instruction, instruction)     # verified Tulu, else English
        ack = acks[group]
        if group in ("C01", "C05", "C06"):
            return reply == f"{ack} {step_text}"
        if group == "C02":
            return reply == ack
        if group == "C03":
            # 1st stop: request cancelled at once + offer to end the conversation
            return reply == f"{ack} {EXIT_OFFER}"
        # C04: Tulu reply + (English) explanation + current step
        return reply.startswith(ack + " ") and reply.endswith(step_text) and reply != f"{ack} {step_text}"

    # ---------------------------------------------------- full matrix
    for wf, (start, progress, wf_name) in WORKFLOWS.items():
        for k in range(1, len(steps[wf]) + 1):
            for state in ("active", "paused"):
                for u in controls:
                    session = f"mx-{uuid.uuid4().hex[:10]}"
                    body = say(session, start)
                    for phrase in progress[:k - 1]:
                        body = say(session, phrase)
                    reached = body["workflow"]["step"] == k and body["workflow"]["name"] == wf_name
                    if state == "paused":
                        body = say(session, "Churu wait malpule")
                        reached = reached and body["workflow"]["state"] == "suspended"
                    before = body["workflow"]["state"]
                    after = say(session, u["tulu_romanized"])
                    g, wfs = u["group"], after["workflow"]
                    instruction = steps[wf][k - 1]
                    if g == "C02":
                        state_ok = wfs["state"] == "suspended"
                    elif g in ("C05", "C06"):
                        state_ok = wfs["state"] == "active"
                    elif g == "C03":
                        state_ok = wfs["state"] == "cancelled"       # cancelled at once, no "are you sure?"
                    else:
                        state_ok = wfs["state"] in (before, "active")   # never paused or ended by these
                    ok = (reached and wfs["step"] == k and wfs["name"] == wf_name and state_ok
                          and after.get("intent") == u["canonical_control"]
                          and expected_reply(g, instruction, after["reply"]))
                    label = f"{wf} step {k} {state}: {u['id']} '{u['tulu_romanized']}'"
                    if g == "C03":
                        again = say(session, u["tulu_romanized"])     # 2nd stop right after: end the conversation
                        ok = ok and again["ended"] is True and again.get("intent") == "EXIT_CONVERSATION"
                    check(label, ok, f"reached={reached} wf={wfs} intent={after.get('intent')} reply={after['reply']!r}")
                    ROWS.append({"workflow": wf, "step": k, "state": state, "id": u["id"], "group": g,
                                 "state_before": before, "state_after": wfs["state"], "step_after": wfs["step"],
                                 "reply": after["reply"], "ok": ok})

    # ---------------------------------------------------- edge states
    for u in controls:
        g = u["group"]
        # no workflow at all
        s = f"mx-{uuid.uuid4().hex[:10]}"
        r = say(s, u["tulu_romanized"])
        if g == "C03":   # nothing to cancel: only the offer to end the conversation
            ok = r["reply"] == f"{acks['C03']} {EXIT_OFFER}" and r["workflow"]["name"] is None and not r["ended"]
        else:
            ok = (not any(r["reply"].startswith(a) for a in acks.values()) and r["workflow"]["name"] is None)
        check(f"no workflow: {u['id']}", ok, r["reply"])
        ROWS.append({"workflow": None, "state": "none", "id": u["id"], "group": g, "reply": r["reply"], "ok": ok})

        # completed workflow (deposit run to the end; last step via a bare completion)
        s = f"mx-{uuid.uuid4().hex[:10]}"
        say(s, WORKFLOWS["deposit"][0])
        for phrase in WORKFLOWS["deposit"][1]:
            say(s, phrase)
        done = say(s, "I have done it.")
        r = say(s, u["tulu_romanized"])
        no_step_claimed = not any(t in r["reply"] for t in tulu.values())
        ok = (done["workflow"]["state"] == "completed" and r["workflow"]["state"] == "completed"
              and no_step_claimed and not r["reply"].startswith(acks.get("C05", "#")) and
              not r["reply"].startswith(acks.get("C06", "#")))
        check(f"completed workflow: {u['id']} (no step restated, not reopened)", ok,
              f"{done['workflow']} -> {r['workflow']} {r['reply']!r}")
        ROWS.append({"workflow": "deposit", "state": "completed", "id": u["id"], "group": g,
                     "reply": r["reply"], "ok": ok})

        # cancel CONFIRMATION pending: the engine asks "are you sure?" before
        # cancelling. A control phrase is not a "yes", so nothing is cancelled
        # and the workflow stays at step 2.
        s = f"mx-{uuid.uuid4().hex[:10]}"
        say(s, WORKFLOWS["withdraw"][0])
        say(s, WORKFLOWS["withdraw"][1][0])                    # -> step 2
        asked = say(s, "cancel")
        r = say(s, u["tulu_romanized"])
        if g == "C03":   # Tulu stop cancels at once, also while the engine's question is pending
            ok = r["workflow"]["state"] == "cancelled" and r["reply"] == f"{acks['C03']} {EXIT_OFFER}"
        else:
            ok = (asked["workflow"]["state"] in ("active", "suspended") and r["workflow"]["step"] == 2
                  and r["workflow"]["state"] in ("active", "suspended") and r["workflow"]["name"] == "withdraw money")
        check(f"cancel confirmation pending: {u['id']} ({'confirms' if g == 'C03' else 'does not cancel'})", ok,
              f"{asked['reply']!r} -> {r['workflow']} {r['reply']!r}")
        ROWS.append({"workflow": "withdraw", "state": "cancel_pending", "id": u["id"], "group": g,
                     "reply": r["reply"], "ok": ok})

        # cancelled workflow (cancel confirmed)
        s = f"mx-{uuid.uuid4().hex[:10]}"
        say(s, WORKFLOWS["withdraw"][0])
        say(s, WORKFLOWS["withdraw"][1][0])
        say(s, "cancel")
        confirmed = say(s, "cancel")   # the engine asks "Say cancel to confirm, or continue to keep it."
        r = say(s, u["tulu_romanized"])
        ok = (confirmed["workflow"]["state"] == "cancelled" and r["workflow"]["state"] != "active"
              and not any(t in r["reply"] for t in tulu.values())
              and not any(r["reply"].startswith(acks[x]) for x in ("C05", "C06")))
        check(f"cancelled workflow: {u['id']} (not reopened, no step restated)", ok,
              f"{confirmed['workflow']} -> {r['workflow']} {r['reply']!r}")
        ROWS.append({"workflow": "withdraw", "state": "cancelled", "id": u["id"], "group": g,
                     "reply": r["reply"], "ok": ok})

    # ---------------------------------------------------- repeated controls
    s = f"mx-{uuid.uuid4().hex[:10]}"
    say(s, WORKFLOWS["withdraw"][0]); say(s, "yan slip dethonde.")          # step 2
    a = say(s, "Churu wait malpule"); b = say(s, "Churu porth unthule")      # pause twice
    c = say(s, "Next panle"); d = say(s, "Next dada")                          # next twice
    e = say(s, "Continue malpule")                                              # continue while active
    step2 = tulu[steps["withdraw"][1]]
    check("pause twice -> still paused at step 2, Tulu reply each time",
          a["workflow"]["state"] == b["workflow"]["state"] == "suspended" and b["reply"] == acks["C02"]
          and b["workflow"]["step"] == 2, b)
    check("next twice -> step 2 both times (never skips)",
          c["reply"] == d["reply"] == f"{acks['C05']} {step2}" and d["workflow"]["step"] == 2, (c, d))
    check("continue while already active -> C06 + step 2, still step 2",
          e["reply"] == f"{acks['C06']} {step2}" and e["workflow"]["step"] == 2, e)

    # stop / exit flow details
    s = f"mx-{uuid.uuid4().hex[:10]}"
    say(s, WORKFLOWS["deposit"][0]); first = say(s, "Eth aav .")
    other = say(s, "Yank duddu padodu?")                  # anything else clears the offer
    later = say(s, "Eth aav .")
    check("stop, then a new request: the offer is dropped and the new request starts",
          first["workflow"]["state"] == "cancelled" and other["workflow"]["state"] == "active"
          and not other["ended"] and later["workflow"]["state"] == "cancelled" and not later["ended"],
          (first, other, later))
    after_exit = say(s, "Eth aav .")                       # 2nd stop right after the offer
    post_exit = say(s, "Yank duddu padodu?")
    check("after exit, every turn gets the farewell (conversation ended)",
          after_exit["ended"] and post_exit["ended"], (after_exit, post_exit))

    llm = [line for line in log.getvalue().splitlines() if "[LLM]" in line]
    check("no LLM call anywhere in the matrix", not llm, llm[:2])
    with redirect_stdout(log):
        client.__exit__(None, None, None)

    by_state = Counter((r["state"], r["ok"]) for r in ROWS)
    summary = {"passed": len(PASSED), "failed": len(FAILED), "situations": len(ROWS),
               "by_state": {f"{k[0]}:{'ok' if k[1] else 'FAIL'}": v for k, v in sorted(by_state.items())},
               "llm_calls": len(llm)}
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "tulu_control_matrix.json").write_text(json.dumps({"summary": summary, "failures": FAILED,
                                                                  "rows": ROWS}, ensure_ascii=False, indent=2),
                                                      encoding="utf-8")
    lines = ["# Tulu control replies — situation matrix", "",
             f"Passed {len(PASSED)}, failed {len(FAILED)} over {len(ROWS)} situations; LLM calls {len(llm)}.", "",
             "| Workflow | Step | State | Control | Reply | State after | Step after | OK |", "|---|---|---|---|---|---|---|---|"]
    for r in ROWS:
        lines.append(f"| {r['workflow']} | {r.get('step', '-')} | {r['state']} | {r['id']} | {r['reply']} | "
                     f"{r.get('state_after', '-')} | {r.get('step_after', '-')} | {'✓' if r['ok'] else '✗'} |")
    (REPORTS / "tulu_control_matrix.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
