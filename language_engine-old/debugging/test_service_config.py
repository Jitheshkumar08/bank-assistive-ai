"""
Regression tests for .env loading.

Runs entirely offline: no Whisper, no embeddings, no Groq, no network.

What is being protected here is unglamorous but easy to get wrong. The
engine reads GROQ_API_KEY from the process environment and raises if it
is absent, so a .env that is not actually applied looks exactly like a
missing key -- and a .env that overrides a real exported variable is
worse, because it works on the machine that wrote it and quietly uses
the wrong key everywhere else.

No test here writes a real secret, and no assertion prints a value.

Run from the language_engine directory:

    python -m debugging.test_service_config
"""

import sys
import tempfile
from pathlib import Path

from service.config import DEFAULT_ENV_PATH, describe, load_env, parse_env_file


PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def write_env(text):
    """A throwaway .env. Never the project's own."""
    directory = Path(tempfile.mkdtemp(prefix="env-test-"))
    path = directory / ".env"
    path.write_text(text, encoding="utf-8")
    return path


# =========================================================
# PARSING
# =========================================================

def test_reads_plain_assignments():
    values = parse_env_file("GROQ_API_KEY=abc123\nPORT=8000\n")

    check("reads a plain value", values.get("GROQ_API_KEY") == "abc123")
    check("reads a second value", values.get("PORT") == "8000")


def test_ignores_comments_and_blank_lines():
    values = parse_env_file("# a comment\n\n   \n# GROQ_API_KEY=commented-out\nPORT=8000\n")

    check("skips comments", "GROQ_API_KEY" not in values)
    check("survives blank lines", values.get("PORT") == "8000")


def test_handles_quotes_and_export():
    values = parse_env_file('A="quoted"\nB=\'single\'\nexport C=exported\n')

    check("strips double quotes", values.get("A") == "quoted")
    check("strips single quotes", values.get("B") == "single")
    check("accepts an export prefix", values.get("C") == "exported")


def test_keeps_characters_that_appear_in_real_keys():
    # Groq keys are long and contain underscores; a parser that mangled
    # one would produce a 401 that looks like a bad key rather than a
    # bad parser.
    values = parse_env_file("GROQ_API_KEY=gsk_AbC-123_xyz==\n")

    check("keeps the whole key", values.get("GROQ_API_KEY") == "gsk_AbC-123_xyz==")


def test_drops_a_trailing_comment_only_when_unquoted():
    values = parse_env_file('A=value # trailing note\nB="value # kept"\n')

    check("drops an unquoted trailing comment", values.get("A") == "value")
    check("keeps a quoted hash", values.get("B") == "value # kept")


def test_ignores_lines_that_are_not_assignments():
    values = parse_env_file("just some prose\n=novalue\n1BAD=x\nGOOD=y\n")

    check("ignores prose", len(values) == 1)
    check("ignores a nameless assignment", "" not in values)
    check("ignores an invalid identifier", "1BAD" not in values)
    check("still reads the valid line", values.get("GOOD") == "y")


# =========================================================
# APPLYING TO THE ENVIRONMENT
# =========================================================

def test_applies_values_to_the_environment():
    environ = {}
    path = write_env("GROQ_API_KEY=from-file\nMAX_AUDIO_BYTES=123\n")

    applied = load_env(path, environ=environ)

    check("sets the key", environ.get("GROQ_API_KEY") == "from-file")
    check("sets other variables too", environ.get("MAX_AUDIO_BYTES") == "123")
    check("reports what it set", sorted(applied) == ["GROQ_API_KEY", "MAX_AUDIO_BYTES"])


def test_a_real_environment_variable_wins():
    environ = {"GROQ_API_KEY": "from-the-shell"}
    path = write_env("GROQ_API_KEY=from-file\n")

    applied = load_env(path, environ=environ)

    # A checked-out file must never override a deployment's own secret.
    check("does not overwrite the shell", environ["GROQ_API_KEY"] == "from-the-shell")
    check("reports that it changed nothing", applied == [])


def test_an_empty_placeholder_changes_nothing():
    environ = {"GROQ_API_KEY": "from-the-shell"}
    path = write_env("GROQ_API_KEY=\nAI_ENGINE_TOKEN=\n")

    applied = load_env(path, environ=environ)

    # The shipped .env.example has empty values. Applying them would turn
    # "not set" into "set but blank", which fails later and less clearly.
    check("keeps the exported key", environ["GROQ_API_KEY"] == "from-the-shell")
    check("does not create a blank variable", "AI_ENGINE_TOKEN" not in environ)
    check("reports nothing applied", applied == [])


def test_a_missing_file_is_not_an_error():
    environ = {}

    applied = load_env(Path(tempfile.mkdtemp()) / "nothing-here", environ=environ)

    # Exporting the variables by hand is a legitimate way to run this.
    check("returns cleanly", applied == [])
    check("leaves the environment alone", environ == {})


def test_describe_never_leaks_a_value():
    summary = describe(["GROQ_API_KEY", "AI_ENGINE_TOKEN"])

    check("lists the names", "GROQ_API_KEY" in summary)
    check("is a name list only", "=" not in summary)
    check("says so when there is nothing", describe([]) == "nothing")


# =========================================================
# THE PROJECT'S OWN FILES
# =========================================================

def test_the_default_path_is_the_engine_env_file():
    check("points at language_engine/.env", DEFAULT_ENV_PATH.name == ".env")
    check(
        "sits beside the service package",
        (DEFAULT_ENV_PATH.parent / "service" / "config.py").is_file(),
        str(DEFAULT_ENV_PATH),
    )


def test_the_example_file_documents_the_key():
    example = DEFAULT_ENV_PATH.parent / ".env.example"

    check("an example file is committed", example.is_file())

    if not example.is_file():
        return

    values = parse_env_file(example.read_text(encoding="utf-8"))

    check("names GROQ_API_KEY", "GROQ_API_KEY" in values)
    # Committing a real key is the failure this whole file exists to
    # keep at arm's length.
    check("ships no secret value", values.get("GROQ_API_KEY") == "")
    check("ships no token value", values.get("AI_ENGINE_TOKEN", "") == "")


def test_importing_the_service_package_loads_the_environment():
    import service

    # The load happens on package import, which is what guarantees the
    # key is present before any app.* module asks for it.
    check("the package exposes what it loaded", hasattr(service, "LOADED_ENV_NAMES"))
    check("it is a list of names", isinstance(service.LOADED_ENV_NAMES, list))


def main():
    tests = [
        test_reads_plain_assignments,
        test_ignores_comments_and_blank_lines,
        test_handles_quotes_and_export,
        test_keeps_characters_that_appear_in_real_keys,
        test_drops_a_trailing_comment_only_when_unquoted,
        test_ignores_lines_that_are_not_assignments,
        test_applies_values_to_the_environment,
        test_a_real_environment_variable_wins,
        test_an_empty_placeholder_changes_nothing,
        test_a_missing_file_is_not_an_error,
        test_describe_never_leaks_a_value,
        test_the_default_path_is_the_engine_env_file,
        test_the_example_file_documents_the_key,
        test_importing_the_service_package_loads_the_environment,
    ]

    print()
    print("=" * 60)
    print("SERVICE ENVIRONMENT REGRESSION TESTS")
    print("=" * 60)

    for test in tests:
        print(f"\n{test.__name__}")
        test()

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
