"""Phase 3.2B-11 step 7: integration check through the production contract.

Calls app.speech.stt.SpeechToText exactly as app/pipeline/voice_pipeline.py does
and verifies the pipeline-facing behaviour, not model accuracy:

  1. the legacy dict contract still holds (text + language present, text is str)
  2. Kannada and Hindi route to IndicConformer and return native-script text
  3. English still routes to Whisper, unchanged
  4. an unsupported language degrades explicitly, never silently
  5. fallback is reported as fallback, not disguised as a normal result

Run from language_engine/:
    python -m debugging.spike.asr_candidates.integration_check
"""
import json
import sys
import time
import unicodedata
from pathlib import Path

SPIKE = Path(__file__).resolve().parents[1]
CORPUS = SPIKE / "corpus" / "indicvoices_banking"
MANIFEST = SPIKE / "indicvoices_banking_manifest.json"
SCRIPT_RANGES = {"kn": (0x0C80, 0x0CFF), "hi": (0x0900, 0x097F)}


def script_share(text, lang):
    lo, hi = SCRIPT_RANGES[lang]
    letters = [c for c in (text or "") if unicodedata.category(c).startswith(("L", "M"))]
    return round(sum(lo <= ord(c) <= hi for c in letters) / len(letters), 3) if letters else 0.0


def main():
    from app.speech.asr import create_recognizer
    from app.speech.stt import SpeechToText

    checks, failures = [], []

    def check(name, ok, detail=""):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})
        print(("  PASS  " if ok else "  FAIL  ") + name + (f"  [{detail}]" if detail else ""))
        if not ok:
            failures.append(name)

    print("routing configuration:")
    router = create_recognizer()
    routing = router.describe_routing(("en", "kn", "hi", "ta", "tcy"))
    print("  " + json.dumps(routing))
    check("kannada routes to indicconformer first",
          routing.get("kn", [None])[:1] == ["indicconformer"], str(routing.get("kn")))
    check("hindi routes to indicconformer first",
          routing.get("hi", [None])[:1] == ["indicconformer"], str(routing.get("hi")))
    check("english routes to whisper", routing.get("en", [None])[:1] == ["whisper"],
          str(routing.get("en")))
    check("tulu is not claimed by any provider", routing.get("tcy") == [], str(routing.get("tcy")))

    print("\ntranscription through SpeechToText (the production entry point):")
    stt = SpeechToText()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    results = {}
    for lang in ("kn", "hi"):
        u = next(x for x in manifest["utterances"] if x["language"] == lang)
        path = CORPUS / lang / f"{u['id']}.wav"
        t0 = time.perf_counter()
        out = stt.transcribe(str(path), language=lang)
        elapsed = time.perf_counter() - t0
        results[lang] = {
            "id": u["id"], "provider": out.get("provider"), "model": out.get("model"),
            "fallback_used": out.get("fallback_used"), "seconds": round(elapsed, 2),
            "rtf": round(elapsed / u["duration_seconds"], 3),
            "script_share": script_share(out["text"], lang),
            "text_preview": out["text"][:90],
        }
        print(f"  [{lang}] {json.dumps(results[lang], ensure_ascii=False)}")
        check(f"{lang}: legacy contract keys present",
              isinstance(out.get("text"), str) and out.get("language") == lang)
        check(f"{lang}: non-empty transcript", bool(out["text"].strip()))
        check(f"{lang}: provider is indicconformer", out.get("provider") == "indicconformer",
              str(out.get("provider")))
        check(f"{lang}: output in the expected script", results[lang]["script_share"] >= 0.9,
              f"script_share={results[lang]['script_share']}")
        check(f"{lang}: no silent fallback", out.get("fallback_used") is False)

    # English: must still be Whisper, behaviour unchanged.
    en_wav = next((p for p in (SPIKE / "corpus" / "audio").rglob("*.wav")), None)
    if en_wav is None:
        print("  SKIP  english clip not found under corpus/audio; routing check only")
        checks.append({"check": "english transcription", "ok": None, "detail": "no clip"})
    else:
        out = stt.transcribe(str(en_wav), language="en")
        print(f"  [en] provider={out.get('provider')} model={out.get('model')} "
              f"text={out['text'][:70]!r}")
        check("english uses whisper", out.get("provider") == "whisper", str(out.get("provider")))
        check("english contract intact", isinstance(out.get("text"), str)
              and out.get("language") == "en")

    print("\nexplicit-failure behaviour:")
    try:
        stt.transcribe(str(CORPUS / "kn" / "ivb_kn_001.wav"), language="tcy")
        check("unsupported language raises instead of guessing", False, "no error raised")
    except Exception as exc:
        check("unsupported language raises instead of guessing",
              isinstance(exc, RuntimeError), f"{type(exc).__name__}")

    out = {"checks": checks, "routing": routing, "results": results,
           "failures": failures, "status": "pass" if not failures else "fail"}
    (Path(__file__).resolve().parent / "integration_check.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall integration checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
