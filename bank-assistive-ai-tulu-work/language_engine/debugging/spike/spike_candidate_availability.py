"""
PART 2 + 3 SPIKE -- candidate ASR and translation availability.

Installs NOTHING. Makes read-only HTTPS GETs to the public PyPI and
Hugging Face metadata APIs and sends nothing but package and model
names.

What this CAN establish as fact:

  - whether a package publishes a wheel this interpreter can install
    (cp313 / win_amd64 / pure-python), and its requires_python
  - whether a model repository exists, is gated, and what licence its
    card declares
  - which languages a model card lists

What this CANNOT establish, and does not claim:

  - transcription or translation QUALITY for any candidate
  - latency, which depends on hardware and audio this repo lacks
  - whether a dependency tree actually RESOLVES together, which only
    a real install into a throwaway venv can prove

The point is to separate "cannot be installed here" from "might work,
needs a real trial". Only the first is decidable offline.
"""

import json
import sys
import urllib.error
import urllib.request


LINE = "=" * 72
TIMEOUT = 30

PY_TAG = "cp" + str(sys.version_info.major) + str(sys.version_info.minor)


# ---------------------------------------------------------------
# Packages a candidate would drag into requirements.txt.
# ---------------------------------------------------------------

PACKAGES = [
    ("sentencepiece", "IndicTrans2 + NLLB tokenizers"),
    ("protobuf", "IndicTrans2 + NLLB tokenizers"),
    ("IndicTransToolkit", "IndicTrans2 pre/post-processing"),
    ("indic-nlp-library", "IndicTrans2 normalisation"),
    ("nemo_toolkit", "AI4Bharat IndicConformer runtime"),
    ("ctranslate2", "faster-whisper / CT2 translation runtime"),
    ("faster-whisper", "Whisper speed alternative"),
    ("transformers", "INSTALLED 5.16.1 -- reference"),
    ("torch", "INSTALLED 2.11.0+cpu -- reference"),
]


# ---------------------------------------------------------------
# Model repositories. Existence + licence + declared languages are
# facts. Quality is not, and is never inferred here.
# ---------------------------------------------------------------

ASR_MODELS = [
    "openai/whisper-small",
    "openai/whisper-large-v3",
    "ai4bharat/indic-conformer-600m-multilingual",
    "ai4bharat/indicwav2vec-hindi",
    "vasista22/whisper-kannada-medium",
    "vasista22/whisper-hindi-large-v2",
]

MT_MODELS = [
    "ai4bharat/indictrans2-indic-en-1B",
    "ai4bharat/indictrans2-en-indic-1B",
    "ai4bharat/indictrans2-indic-en-dist-200M",
    "ai4bharat/indictrans2-en-indic-dist-200M",
    "facebook/nllb-200-distilled-600M",
    "facebook/nllb-200-distilled-1.3B",
]

# Codes this product serves or proposes to serve.
#
# Each target is matched against BOTH its ISO-639-1 and its ISO-639-3
# form, because model cards do not agree on a convention: Whisper and
# IndicTrans2 declare Marathi as "mr", NLLB-200 declares it as "mar".
# Matching on one form alone reports a false coverage gap -- the first
# run of this probe did exactly that and wrongly showed NLLB missing
# Marathi.
TARGET_LANGUAGES = (
    ("kn", "kan"),
    ("hi", "hin"),
    ("ta", "tam"),
    ("te", "tel"),
    ("ml", "mal"),
    ("mr", "mar"),
)


def target_label(aliases):
    return aliases[0]


def covers(aliases, declared):
    return any(alias in declared for alias in aliases)


def get_json(url):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "phase32b6-spike/1.0 (read-only metadata probe)"},
    )

    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def header(title):
    print()
    print(LINE)
    print(title)
    print(LINE)


# ---------------------------------------------------------------
# PyPI
# ---------------------------------------------------------------

def classify_wheels(files):
    """
    Splits a release's files into what this interpreter could use.

    Distinguishes THREE different kinds of "no": no wheel for this
    Python at all, a wheel for this Python but not for Windows, and
    source-only. They have very different consequences -- the middle
    case installs cleanly on a Linux deployment target and forces a
    C++ source build only on this Windows dev machine, which is a
    scheduling problem rather than a blocker.
    """

    pure = []
    here = []
    right_python_wrong_os = []
    other_wheels = []
    sdists = []

    for entry in files:
        name = entry.get("filename", "")

        if name.endswith(".tar.gz") or name.endswith(".zip"):
            sdists.append(name)
            continue

        if not name.endswith(".whl"):
            continue

        if "-none-any.whl" in name:
            pure.append(name)
        elif PY_TAG in name and "win_amd64" in name:
            here.append(name)
        elif PY_TAG in name:
            right_python_wrong_os.append(name)
        else:
            other_wheels.append(name)

    if pure:
        return "PURE-PYTHON WHEEL", pure[:1]

    if here:
        return PY_TAG + "/win_amd64 WHEEL", here[:1]

    if right_python_wrong_os:
        return (
            PY_TAG + " WHEEL BUT NOT FOR WINDOWS (source build here)",
            right_python_wrong_os[:1],
        )

    if other_wheels or sdists:
        return "NO " + PY_TAG + " WHEEL AT ALL", other_wheels[:1] or sdists[:1]

    return "NO FILES", []


def probe_package(name, why):
    try:
        data = get_json("https://pypi.org/pypi/" + name + "/json")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            print("  " + name.ljust(22) + " NOT ON PYPI under this name")
        else:
            print("  " + name.ljust(22) + " HTTP " + str(error.code))
        return None
    except Exception as error:
        print("  " + name.ljust(22) + " probe failed: " + type(error).__name__)
        return None

    info = data.get("info", {})
    version = info.get("version", "?")
    requires_python = info.get("requires_python") or "unspecified"
    licence = (info.get("license") or "").strip() or "see classifiers"

    kind, examples = classify_wheels(data.get("urls", []))

    print("  " + name.ljust(22) + " " + str(version).ljust(12) + kind)
    print("      requires_python : " + str(requires_python))
    print("      licence (meta)  : " + licence[:58])
    print("      why it matters  : " + why)

    if examples:
        print("      sample file     : " + examples[0])

    return {
        "name": name,
        "version": version,
        "requires_python": requires_python,
        "kind": kind,
    }


def section_packages():
    header("PART 2/3(a)  PyPI -- can this interpreter install it at all?")
    print("  interpreter tag: " + PY_TAG + " / win_amd64 / Python "
          + sys.version.split()[0])
    print()

    results = []

    for name, why in PACKAGES:
        outcome = probe_package(name, why)

        if outcome is not None:
            results.append(outcome)

        print()

    return results


# ---------------------------------------------------------------
# Hugging Face
# ---------------------------------------------------------------

def probe_model(repo_id):
    try:
        data = get_json("https://huggingface.co/api/models/" + repo_id)
    except urllib.error.HTTPError as error:
        status = "GATED or PRIVATE" if error.code in (401, 403) else "HTTP " + str(error.code)

        if error.code == 404:
            status = "DOES NOT EXIST under this id"

        print("  " + repo_id.ljust(46) + " " + status)
        return None
    except Exception as error:
        print("  " + repo_id.ljust(46) + " probe failed: " + type(error).__name__)
        return None

    card = data.get("cardData") or {}
    licence = card.get("license") or "NOT DECLARED ON CARD"
    gated = data.get("gated", False)
    downloads = data.get("downloads", 0)

    languages = card.get("language") or []

    if isinstance(languages, str):
        languages = [languages]

    covered = [
        target_label(aliases)
        for aliases in TARGET_LANGUAGES
        if covers(aliases, languages)
    ]
    missing = [
        target_label(aliases)
        for aliases in TARGET_LANGUAGES
        if not covers(aliases, languages)
    ]

    print("  " + repo_id.ljust(46) + " EXISTS   gated=" + str(gated))
    print("      licence        : " + str(licence))
    print("      downloads/30d  : " + str(downloads))
    print("      card languages : " + (str(len(languages)) + " declared" if languages else "none declared"))

    if languages:
        print("      target covered : " + (", ".join(covered) or "none"))
        print("      target missing : " + (", ".join(missing) or "none"))

    return {
        "repo_id": repo_id,
        "licence": licence,
        "gated": gated,
        "covered": covered,
        "missing": missing,
        "declared": len(languages),
    }


def section_models(title, repo_ids):
    header(title)

    results = []

    for repo_id in repo_ids:
        outcome = probe_model(repo_id)

        if outcome is not None:
            results.append(outcome)

        print()

    return results


def section_limits():
    header("WHAT THIS PROBE DOES NOT ESTABLISH")

    print()
    print("  NOT MEASURED -- transcription accuracy, translation quality,")
    print("  latency, memory footprint, digit fidelity, or behaviour on")
    print("  code-mixed speech, for ANY candidate above.")
    print()
    print("  A green row means only: the artefact exists and could be")
    print("  fetched. It does NOT mean the dependency tree resolves")
    print("  against torch 2.11.0 + transformers 5.16.1 on Python 3.13.")
    print("  Only a real install into a THROWAWAY venv proves that, and")
    print("  this spike is forbidden from installing anything.")
    print()
    print("  Treat every 'might work' below as a hypothesis with a cost")
    print("  attached, not as a finding.")


def main():
    print()
    print(LINE)
    print("PHASE 3.2B-6 SPIKE -- PARTS 2 AND 3: CANDIDATE AVAILABILITY")
    print(LINE)

    packages = section_packages()
    asr = section_models("PART 2(b)  ASR MODEL REPOSITORIES", ASR_MODELS)
    mt = section_models("PART 3(b)  TRANSLATION MODEL REPOSITORIES", MT_MODELS)

    section_limits()

    header("SUMMARY")

    clean = [p for p in packages if "WHEEL" in p["kind"] and "NOT FOR" not in p["kind"]]
    source_build = [p for p in packages if "NOT FOR WINDOWS" in p["kind"]]
    blocked = [p for p in packages if p["kind"].startswith("NO ")]

    print("  installs cleanly here     : "
          + (", ".join(p["name"] for p in clean) or "none"))
    print("  source build on Windows   : "
          + (", ".join(p["name"] for p in source_build) or "none"))
    print("  no wheel for " + PY_TAG + " at all : "
          + (", ".join(p["name"] for p in blocked) or "none"))
    print("  ASR repos reachable       : " + str(len(asr)) + "/" + str(len(ASR_MODELS)))
    print("  MT repos reachable        : " + str(len(mt)) + "/" + str(len(MT_MODELS)))
    print("  QUALITY / LATENCY         : NOT MEASURED for any candidate")
    print()


if __name__ == "__main__":
    main()
