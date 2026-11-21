"""
PHASE 3.2B-7 -- TRANSLATION BENCHMARK (typed text, no audio)

Measures whether a translation boundary preserves the things a banking
assistant cannot afford to lose: amounts, account numbers, names,
negation and control commands.

This is the one half of Phase 3.2B-7 that CAN be measured today --
it needs no speech corpus.

WHAT THIS IS NOT
  - not wired into the production pipeline
  - not app/translation/translator.py, which stays the untouched stub
  - not entity_guard.py
  - not a production translation implementation

It builds its OWN Groq client from the same environment variable the
engine uses, so nothing in app/ or service/ is imported, modified or
influenced. The API key is read, never printed and never written to
the results file.

Run from language_engine/:

    $env:PYTHONIOENCODING = "utf-8"
    .\\venv\\Scripts\\python.exe -m debugging.spike.benchmark_translation

With no GROQ_API_KEY present it reports NOT MEASURED and exits.
"""

import json
import os
import statistics
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

from debugging.spike.benchmark_asr import (
    fold_digits,
    normalise_for_scoring,
    parse_amount,
)


SPIKE_DIR = Path(__file__).resolve().parent
RESULTS_FILE = SPIKE_DIR / "translation_results.json"

LINE = "=" * 72

# Same model the production dialogue path uses, so the measurement is
# about the translation task rather than about a model we do not run.
MODEL = "openai/gpt-oss-20b"

LANGUAGE_NAMES = {"en": "English", "kn": "Kannada", "hi": "Hindi"}


# =========================================================
# CASES
#
# Step 12 safety cases A-G, plus code-mixing. Every identifier and name
# is SYNTHETIC.
# =========================================================

def regional_cases(language):
    """Cases whose source is Kannada or Hindi, translated INTO English."""

    kn = language == "kn"

    return [
        {
            "id": language + "_amount_lakh",
            "category": "amount",
            "severity": 1,
            "source": "ನನಗೆ ಎರಡು ಲಕ್ಷ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು" if kn
                      else "मुझे दो लाख रुपये जमा करने हैं",
            "expect_amount": 200000,
        },
        {
            "id": language + "_amount_crore",
            "category": "amount",
            "severity": 1,
            "source": "ಎರಡು ಕೋಟಿ ರೂಪಾಯಿ ಸಾಲ ಬೇಕು" if kn
                      else "दो करोड़ रुपये का लोन चाहिए",
            "expect_amount": 20000000,
        },
        {
            "id": language + "_amount_thousand",
            "category": "amount",
            "severity": 1,
            "source": "ಇಪ್ಪತ್ತು ಸಾವಿರ ರೂಪಾಯಿ ತೆಗೆಯಬೇಕು" if kn
                      else "बीस हज़ार रुपये निकालने हैं",
            "expect_amount": 20000,
        },
        {
            "id": language + "_account_number",
            "category": "account_number",
            "severity": 1,
            "source": "ನನ್ನ ಖಾತೆ ಸಂಖ್ಯೆ 1234567890" if kn
                      else "मेरा खाता नंबर 1234567890 है",
            "expect_exact": ["1234567890"],
        },
        {
            "id": language + "_phone_number",
            "category": "account_number",
            "severity": 1,
            "source": "ನನ್ನ ಫೋನ್ ನಂಬರ್ 9876543210" if kn
                      else "मेरा फोन नंबर 9876543210 है",
            "expect_exact": ["9876543210"],
        },
        {
            "id": language + "_name_trap",
            "category": "name",
            "severity": 1,
            "source": "ನನ್ನ ಹೆಸರು ಕಮಲಾ" if kn else "मेरा नाम कमला है",
            "expect_absent": ["lotus"],
            "expect_name_like": ["kamala", "kamla"],
        },
        {
            "id": language + "_negation_cancel",
            "category": "negation",
            "severity": 1,
            "source": "ರದ್ದು ಮಾಡಬೇಡಿ" if kn else "रद्द मत कीजिए",
            "expect_negation": True,
        },
        {
            "id": language + "_negation_withdraw",
            "category": "negation",
            "severity": 1,
            "source": "ನನಗೆ ಹಣ ತೆಗೆಯುವುದು ಬೇಡ" if kn
                      else "मुझे पैसे नहीं निकालने हैं",
            "expect_negation": True,
        },
        {
            "id": language + "_completion",
            "category": "workflow",
            "severity": 2,
            "source": "ನಾನು ಮೊತ್ತವನ್ನು ಬರೆದಿದ್ದೇನೆ" if kn
                      else "मैंने राशि भर दी है",
            "expect_any": ["entered", "filled", "written", "completed", "have"],
            "expect_absent": ["will", "going to"],
        },
        {
            "id": language + "_control_pause",
            "category": "control",
            "severity": 1,
            "source": "ಸ್ವಲ್ಪ ನಿಲ್ಲಿಸಿ" if kn else "थोड़ा रुकिए",
            "expect_any": ["pause", "wait", "stop", "hold"],
        },
        {
            "id": language + "_exit",
            "category": "control",
            "severity": 1,
            "source": "ಸಾಕು, ಮುಗಿಸೋಣ" if kn else "बस, ख़त्म कीजिए",
            "expect_any": ["finish", "done", "enough", "end", "stop", "exit", "close"],
        },
        {
            "id": language + "_code_mixed",
            "category": "code_mixed",
            "severity": 2,
            "source": "ನನಗೆ account number fill ಮಾಡಬೇಕು" if kn
                      else "मुझे account number fill करना है",
            "expect_any": ["account number"],
        },
    ]


#: English sources, evaluated by ROUND TRIP (en -> X -> en).
ENGLISH_CASES = [
    {
        "id": "en_amount_lakh", "category": "amount", "severity": 1,
        "source": "Deposit 2 lakh rupees", "expect_amount": 200000,
    },
    {
        "id": "en_amount_grouped", "category": "amount", "severity": 1,
        "source": "Withdraw 2,00,000 rupees", "expect_amount": 200000,
    },
    {
        "id": "en_account_number", "category": "account_number", "severity": 1,
        "source": "My account number is 1234567890", "expect_exact": ["1234567890"],
    },
    {
        "id": "en_name_trap", "category": "name", "severity": 1,
        "source": "My name is Kamala Shetty",
        "expect_absent": ["lotus"], "expect_name_like": ["kamala", "kamla"],
    },
    {
        "id": "en_negation_cancel", "category": "negation", "severity": 1,
        "source": "Do not cancel", "expect_negation": True,
    },
    {
        "id": "en_negation_withdraw", "category": "negation", "severity": 1,
        "source": "I don't want to withdraw money", "expect_negation": True,
    },
    {
        "id": "en_workflow", "category": "workflow", "severity": 2,
        "source": "I entered the amount",
        "expect_any": ["entered", "filled", "wrote", "written", "put"],
    },
    {
        "id": "en_control_pause", "category": "control", "severity": 1,
        "source": "Pause", "expect_any": ["pause", "wait", "stop", "hold"],
    },
]


# =========================================================
# TRANSLATION CLIENT (benchmark-local, production untouched)
# =========================================================

#: Paced so a 56-call run does not trip the free-tier rate limit. A 429
#: costs a measurement, and an unmeasured case is worse than a slow run.
CALL_SPACING_SECONDS = 0.4


class BenchmarkTranslator:
    def __init__(self, client):
        self.client = client
        self.latencies = []

    def translate(self, text, source, target):
        time.sleep(CALL_SPACING_SECONDS)

        prompt = (
            "Translate the following " + LANGUAGE_NAMES[source] + " text into "
            + LANGUAGE_NAMES[target] + ".\n\n"
            "Rules:\n"
            "1. Preserve every digit exactly as written. Never regroup, "
            "reformat, spell out or alter a number.\n"
            "2. Transliterate personal names. Never translate a name into "
            "its literal meaning.\n"
            "3. Preserve negation exactly. A refusal must stay a refusal.\n"
            "4. Keep the same speech act: a request stays a request, a "
            "command stays a command, a completed action stays completed.\n"
            "5. Return ONLY the translation, with no commentary.\n\n"
            "TEXT:\n" + text
        )

        started = time.time()

        try:
            response = self.client.chat.completions.create(
                model=MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a precise translator for a banking assistant.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0,
            )

            output = (response.choices[0].message.content or "").strip()
            failure = None

        except Exception as error:
            output = ""
            failure = type(error).__name__ + ": " + str(error)

        elapsed = time.time() - started
        self.latencies.append(elapsed)

        return output, elapsed, failure


# =========================================================
# EVALUATION
# =========================================================

def english_negation(text):
    """
    Uses the PRODUCTION negation detector as an evaluation only.

    This is the same function the deterministic control tier depends on
    (manager.py:284), so a False here is precisely the failure mode that
    would let a refusal execute as a command.
    """

    from app.dialogue.manager import contains_negation

    return contains_negation(text or "")


def evaluate(case, output):
    """Returns (checks, failures) for one translated string."""

    checks = {}
    lowered = (output or "").lower()
    folded = fold_digits(lowered).replace(" ", "")

    if "expect_amount" in case:
        parsed = parse_amount(output)
        checks["amount"] = {
            "expected": case["expect_amount"],
            "got": parsed,
            "ok": parsed == case["expect_amount"],
        }

    if "expect_exact" in case:
        for token in case["expect_exact"]:
            checks["exact:" + token] = {
                "expected": token,
                "ok": token in folded,
            }

    if "expect_absent" in case:
        present = [t for t in case["expect_absent"] if t.lower() in lowered]
        checks["absent"] = {
            "forbidden": case["expect_absent"],
            "present": present,
            "ok": not present,
        }

    if "expect_name_like" in case:
        checks["name"] = {
            "expected_any": case["expect_name_like"],
            "ok": any(n in lowered for n in case["expect_name_like"]),
        }

    if "expect_negation" in case:
        detected = english_negation(output)
        checks["negation"] = {
            "expected": case["expect_negation"],
            "got": detected,
            "ok": detected == case["expect_negation"],
        }

    if "expect_any" in case:
        hits = [t for t in case["expect_any"] if t.lower() in lowered]
        checks["semantics"] = {
            "expected_any": case["expect_any"],
            "hits": hits,
            "ok": bool(hits),
        }

    failures = [name for name, detail in checks.items() if not detail["ok"]]

    return checks, failures


# =========================================================
# RUN
# =========================================================

def run_direction(translator, label, cases, source, target, round_trip_via=None):
    print()
    print("  " + label)

    rows = []

    def unmeasured(case, failure, seconds):
        """
        An API failure is NOT a translation-quality failure.

        It must stay visible with its direction attached -- an earlier
        run dropped `direction` from this row, so a rate-limited case
        disappeared from its direction's denominator and the report read
        7/7 when one case had never been measured at all.
        """

        row = dict(case)
        row.update({
            "direction": label,
            "output": "",
            "intermediate": None,
            "checks": {},
            "failed_checks": [],
            "failure": failure,
            "seconds": round(seconds, 3),
        })

        return row

    for case in cases:
        if round_trip_via:
            forward, t1, fail1 = translator.translate(case["source"], source, round_trip_via)

            if fail1:
                rows.append(unmeasured(case, fail1, t1))
                print("    [n/m ] " + case["id"] + "  NOT MEASURED: " + fail1[:45])
                continue

            output, t2, fail2 = translator.translate(forward, round_trip_via, target)
            elapsed = t1 + t2
            failure = fail2
            intermediate = forward
        else:
            output, elapsed, failure = translator.translate(case["source"], source, target)
            intermediate = None

        if failure:
            rows.append(unmeasured(case, failure, elapsed))
            print("    [n/m ] " + case["id"] + "  NOT MEASURED: " + failure[:45])
            continue

        checks, failures = evaluate(case, output)

        rows.append({
            "id": case["id"],
            "category": case["category"],
            "severity": case["severity"],
            "direction": label,
            "source": case["source"],
            "intermediate": intermediate,
            "output": output,
            "seconds": round(elapsed, 3),
            "checks": checks,
            "failed_checks": failures,
            "failure": None,
        })

        status = "ok  " if not failures else "MISS"
        print("    [" + status + "] " + case["id"].ljust(24)
              + format(elapsed, ".2f") + "s  " + repr(output[:58]))

        for name in failures:
            print("           FAILED CHECK: " + name + "  " + str(checks[name]))

    return rows


def report(rows, translator):
    print()
    print(LINE)
    print("TRANSLATION RESULTS BY DIRECTION")
    print(LINE)

    for direction in sorted({r["direction"] for r in rows if r.get("direction")}):
        subset = [r for r in rows if r.get("direction") == direction]
        measured = [r for r in subset if not r["failure"]]
        clean = [r for r in measured if not r["failed_checks"]]
        unmeasured_n = len(subset) - len(measured)

        print()
        print("  " + direction + " : " + str(len(clean)) + "/" + str(len(measured))
              + " measured cases fully preserved"
              + ("   [" + str(unmeasured_n) + " NOT MEASURED - API failure]" if unmeasured_n else ""))

    print()
    print(LINE)
    print("BY CATEGORY (severity 1 first)")
    print(LINE)

    categories = sorted(
        {r["category"] for r in rows},
        key=lambda c: (min(r["severity"] for r in rows if r["category"] == c), c),
    )

    for category in categories:
        subset = [r for r in rows if r["category"] == category]
        measured = [r for r in subset if not r["failure"]]
        clean = [r for r in measured if not r["failed_checks"]]
        severity = min(r["severity"] for r in subset)
        unmeasured_n = len(subset) - len(measured)

        print("  sev" + str(severity) + "  " + category.ljust(16)
              + str(len(clean)) + "/" + str(len(measured)) + " preserved"
              + ("   (" + str(unmeasured_n) + " not measured)" if unmeasured_n else ""))

    not_measured = [r for r in rows if r["failure"]]

    if not_measured:
        print()
        print("  NOT MEASURED (" + str(len(not_measured)) + " cases -- API failure, not a quality result):")

        for row in not_measured:
            print("      " + row["id"] + "  " + str(row["failure"])[:70])

    print()
    print(LINE)
    print("SAFETY-CRITICAL FAILURES (severity 1, measured cases only)")
    print(LINE)

    critical = [
        r for r in rows
        if r["severity"] == 1 and not r["failure"] and r["failed_checks"]
    ]

    if not critical:
        print()
        print("  none in this run")
    else:
        print()

        for row in critical:
            print("  " + row["id"] + "  [" + row.get("direction", "?") + "]")
            print("      source : " + repr(row["source"]))
            print("      output : " + repr(row["output"]))
            print("      failed : " + str(row["failed_checks"]))
            print()

    print(LINE)
    print("TRANSLATION LATENCY (per API call, this machine, this network)")
    print(LINE)

    times = translator.latencies

    if times:
        print()
        print("  calls               : " + str(len(times)))
        print("  seconds min/med/max : "
              + format(min(times), ".2f") + " / "
              + format(statistics.median(times), ".2f") + " / "
              + format(max(times), ".2f"))
        print()
        print("  A regional turn needs TWO of these calls (inbound and")
        print("  outbound), on top of the existing understand() call and,")
        print("  for a question, answer_question(). No claim is made here")
        print("  about whether that total is acceptable.")

    print()
    print(LINE)
    print("SCOPE OF THIS MEASUREMENT")
    print(LINE)
    print()
    print("  MEASURED     : Groq " + MODEL + " translation only.")
    print("  NOT MEASURED : IndicTrans2 -- requires a disposable venv and")
    print("                 a Windows source build of IndicTransToolkit.")
    print("  NOT MEASURED : NLLB-200 -- excluded on licence (CC-BY-NC-4.0).")
    print("  NOT MEASURED : anything involving speech. This benchmark is")
    print("                 typed text end to end.")


def main():
    load_dotenv(override=False)

    api_key = (os.getenv("GROQ_API_KEY") or "").strip()

    print()
    print(LINE)
    print("PHASE 3.2B-7 -- TRANSLATION BENCHMARK (typed text)")
    print(LINE)

    if not api_key:
        print()
        print("  STATUS: NOT MEASURED -- GROQ_API_KEY is not set.")
        print()
        print("  No translation result is estimated or simulated.")
        print()
        return 0

    from groq import Groq

    translator = BenchmarkTranslator(Groq(api_key=api_key))

    print()
    print("  model    : " + MODEL)
    print("  api key  : present (value never printed or stored)")
    print("  cases    : Step 12 safety cases A-G plus code-mixing")

    rows = []

    rows += run_direction(translator, "kn -> en", regional_cases("kn"), "kn", "en")
    rows += run_direction(translator, "hi -> en", regional_cases("hi"), "hi", "en")
    rows += run_direction(
        translator, "en -> kn -> en (round trip)", ENGLISH_CASES, "en", "en",
        round_trip_via="kn",
    )
    rows += run_direction(
        translator, "en -> hi -> en (round trip)", ENGLISH_CASES, "en", "en",
        round_trip_via="hi",
    )

    report(rows, translator)

    with open(RESULTS_FILE, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "phase": "3.2B-7",
                "model": MODEL,
                "note": "API key never stored in this file.",
                "latency_seconds": [round(t, 3) for t in translator.latencies],
                "results": rows,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )

    print()
    print("  raw results written to " + str(RESULTS_FILE))
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
