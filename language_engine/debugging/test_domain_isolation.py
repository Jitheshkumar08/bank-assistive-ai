"""
Phase 2 (domain integration): domain resolution, authentication and isolation.

Runs entirely offline: no Whisper, no embeddings, no Groq, no network. Every
runtime here is a fake that records which domain served each turn, so the
tests prove ROUTING and ISOLATION, not answer quality.

What must hold:

  - A request's domain comes from the caller's token. A declaration can only
    confirm it; an unknown domain is refused; nothing falls back to Banking
    once a caller has identified itself (or declared another domain).
  - Banking's pre-domain contract keeps working unchanged.
  - Banking and College sessions never share state, even with the same id.
  - A College session is fixed to its institution.
  - A domain whose runtime is unavailable is refused, never served by another.
  - Production refuses to start without a distinct token per domain.

Run from language_engine/:

    python -m debugging.test_domain_isolation
"""

import sys
import threading
from types import SimpleNamespace

from fastapi.testclient import TestClient

import service.engine as engine_module
import service.main as main
from app.domains import COLLEGE, DOMAINS, UnknownDomainError, get_domain
from app.domains.base import ContextPolicy, DomainConfig
from app.workflow.loader import WorkflowLoader
from service.domains import (
    Caller,
    ContextConflict,
    DomainAuth,
    DomainForbidden,
    InvalidContext,
    NotAuthorised,
    UnknownDomain,
    validate_context,
)
from service.engine import TurnResult
from service.models import TextTurnRequest
from service.registry import SessionRegistry

PASSED = []
FAILED = []

BANK_TOKEN = "bank-token-" + "b" * 40
COLLEGE_TOKEN = "college-token-" + "c" * 40
NMAMIT = {"institution_id": "nmamit", "area": "admissions"}


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def raises(error_type, call):
    try:
        call()
    except error_type:
        return True
    except Exception as other:  # noqa: BLE001 - reported as a failure
        print(f"        (raised {type(other).__name__} instead)")
        return False
    return False


class FakeRuntime:
    """Stands in for EngineRuntime: records turns, loads nothing."""

    _loader = WorkflowLoader()

    def __init__(self, name):
        self.name = name
        self.turns = []
        self._lock = threading.Lock()
        self.dialogue = SimpleNamespace(workflow_loader=self._loader)

    def run_turn(self, conversation, text, localizer=None):
        with self._lock:
            self.turns.append((id(conversation), text))
        conversation.add_history("User", text)
        return TurnResult(reply=f"{self.name}:{text}", canonical_reply=f"{self.name}:{text}")

    @staticmethod
    def has_exited(conversation):
        return False


class Service:
    """The real FastAPI app with fake runtimes and chosen tokens."""

    def __init__(self, bank_token="", college_token="", college_available=True):
        self.bank_token, self.college_token = bank_token, college_token
        self.college_available = college_available

    def __enter__(self):
        self.saved = (main.get_runtime, main.INTERNAL_TOKEN, main.COLLEGE_TOKEN, main.ENGINE_ENV)
        self.banking = FakeRuntime("banking")
        self.college = FakeRuntime("college")
        main.get_runtime = lambda: self.banking
        main.INTERNAL_TOKEN, main.COLLEGE_TOKEN = self.bank_token, self.college_token
        main.ENGINE_ENV = "development"
        engine_module.unregister_domain_runtime("college")
        if self.college_available:
            engine_module.register_domain_runtime("college", lambda: self.college)
        main.registry.clear()
        # No `with`: the lifespan (model loading) does not run.
        self.client = TestClient(main.app, raise_server_exceptions=True)
        return self

    def __exit__(self, *exc):
        main.get_runtime, main.INTERNAL_TOKEN, main.COLLEGE_TOKEN, main.ENGINE_ENV = self.saved
        engine_module.unregister_domain_runtime("college")
        main.registry.clear()

    def turn(self, text="hello", session="S1", token=None, domain_header=None, **body):
        headers = {}
        if token:
            headers["X-Internal-Token"] = token
        if domain_header:
            headers["X-Assistant-Domain"] = domain_header
        payload = {"session_id": session, "language": "en", "text": text, **body}
        return self.client.post("/turn", json=payload, headers=headers)


# =========================================================
# DOMAIN CONFIGURATION
# =========================================================

def test_registry_lists_exactly_the_supported_domains():
    check("banking and college are registered", set(DOMAINS) == {"banking", "college"})
    check("get_domain returns the config", get_domain("college") is COLLEGE)
    check("unknown domain raises, no default", raises(UnknownDomainError, lambda: get_domain("insurance")))
    check("non-string domain raises", raises(UnknownDomainError, lambda: get_domain(None)))


def test_domain_config_is_validated():
    check("invalid domain id refused",
          raises(ValueError, lambda: DomainConfig(id="Bad Id", display_name="x", token_env="X")))
    check("unknown context key refused",
          raises(ValueError, lambda: ContextPolicy(allowed=frozenset({"student_id"}))))
    check("required key must be allowed",
          raises(ValueError, lambda: ContextPolicy(required=frozenset({"institution_id"}))))
    check("domains use distinct token variables",
          len({config.token_env for config in DOMAINS.values()}) == len(DOMAINS))


# =========================================================
# TOKEN -> DOMAIN RESOLUTION
# =========================================================

def test_resolution_with_tokens():
    auth = DomainAuth({"banking": BANK_TOKEN, "college": COLLEGE_TOKEN})

    check("banking token -> banking", auth.resolve(auth.authenticate(BANK_TOKEN)) == "banking")
    check("college token -> college", auth.resolve(auth.authenticate(COLLEGE_TOKEN)) == "college")
    check("college token declaring college -> college",
          auth.resolve(auth.authenticate(COLLEGE_TOKEN), ["college"]) == "college")
    check("missing token refused", raises(NotAuthorised, lambda: auth.authenticate(None)))
    check("wrong token refused", raises(NotAuthorised, lambda: auth.authenticate("guess")))
    check("college token cannot declare banking",
          raises(DomainForbidden, lambda: auth.resolve("college", ["banking"])))
    check("banking token cannot declare college",
          raises(DomainForbidden, lambda: auth.resolve("banking", ["college"])))
    check("unknown declaration refused even with a valid token",
          raises(UnknownDomain, lambda: auth.resolve("college", ["insurance"])))
    check("unauthenticated resolve refused when auth is on",
          raises(NotAuthorised, lambda: auth.resolve(None, ["college"])))


def test_resolution_without_tokens_in_development():
    auth = DomainAuth({"banking": "", "college": ""}, "development")

    check("auth is disabled", not auth.auth_enabled)
    check("authenticate returns no domain", auth.authenticate(None) is None)
    check("undeclared request keeps the legacy Banking contract", auth.resolve(None) == "banking")
    check("declared college -> college", auth.resolve(None, ["college"]) == "college")
    check("declaration is case/space tolerant", auth.resolve(None, [" College "]) == "college")
    check("unknown declaration refused", raises(UnknownDomain, lambda: auth.resolve(None, ["insurance"])))
    check("conflicting declarations refused",
          raises(DomainForbidden, lambda: auth.resolve(None, ["college", "banking"])))


def test_one_token_turns_authentication_on_for_everyone():
    auth = DomainAuth({"banking": BANK_TOKEN, "college": ""})

    check("auth enabled by a single token", auth.auth_enabled)
    check("college without a token is refused", raises(NotAuthorised, lambda: auth.authenticate(None)))


def test_startup_checks():
    good = DomainAuth({"banking": BANK_TOKEN, "college": COLLEGE_TOKEN}, "production")
    check("production with two distinct long tokens starts", good.startup_problems() == [])

    missing = DomainAuth({"banking": BANK_TOKEN, "college": ""}, "production").startup_problems()
    check("production without the college token refuses",
          any("AI_ENGINE_COLLEGE_TOKEN" in p for p in missing), str(missing))

    none = DomainAuth({"banking": "", "college": ""}, "production").startup_problems()
    check("production with no tokens refuses", len(none) == 2, str(none))

    short = DomainAuth({"banking": "short", "college": COLLEGE_TOKEN}, "production").startup_problems()
    check("production refuses a short token", any("32" in p for p in short), str(short))

    shared = DomainAuth({"banking": BANK_TOKEN, "college": BANK_TOKEN}, "development").startup_problems()
    check("a token shared by two domains refuses, even in development", len(shared) == 1, str(shared))

    bogus = DomainAuth({"banking": "", "college": ""}, "staging").startup_problems()
    check("unknown AI_ENGINE_ENV refuses", len(bogus) == 1, str(bogus))

    dev = DomainAuth({"banking": "", "college": ""}, "development").startup_problems()
    check("development without tokens may start (with a warning)", dev == [])

    joined = " ".join(missing + short + shared)
    check("problems never contain token values",
          BANK_TOKEN not in joined and COLLEGE_TOKEN not in joined and "short" not in joined.replace("characters", ""))


# =========================================================
# CONTEXT POLICY
# =========================================================

def test_context_validation():
    check("college context accepted", validate_context("college", NMAMIT) == NMAMIT)
    check("college without institution refused",
          raises(InvalidContext, lambda: validate_context("college", {"area": "admissions"})))
    check("college with no context refused",
          raises(InvalidContext, lambda: validate_context("college", None)))
    check("college context refused in a banking turn",
          raises(InvalidContext, lambda: validate_context("banking", {"institution_id": "nmamit"})))
    check("branch context refused in a college turn",
          raises(InvalidContext, lambda: validate_context("college", {**NMAMIT, "branch_id": "B1"})))
    check("banking with no context accepted", validate_context("banking", None) == {})
    check("free text refused as a context value",
          raises(InvalidContext, lambda: validate_context("college", {"institution_id": "drop table; --"})))
    check("None values are ignored", validate_context("banking", {"branch_id": None}) == {})


# =========================================================
# REGISTRY ISOLATION
# =========================================================

def test_same_session_id_in_two_domains_is_two_sessions():
    registry = SessionRegistry()

    bank = registry.get_or_create("S1", domain="banking")
    college = registry.get_or_create("S1", domain="college", bound={"institution_id": "nmamit"})

    check("different conversations", bank.conversation is not college.conversation)
    check("two entries held", len(registry) == 2)
    check("entries carry their domain", bank.domain == "banking" and college.domain == "college")

    bank.conversation.add_history("User", "my account number is 123")
    check("history does not cross domains",
          all("123" not in str(item) for item in getattr(college.conversation, "history", [])))

    check("peek finds only the asked domain",
          registry.peek("S1", domain="college") is college and registry.peek("S1") is bank)
    check("removing the college session leaves banking", registry.remove("S1", domain="college")
          and registry.peek("S1", domain="banking") is bank)
    check("unknown domain sees nothing", registry.peek("S1", domain="other") is None)


def test_session_is_bound_to_its_institution():
    registry = SessionRegistry()

    first = registry.get_or_create("S1", domain="college", bound={"institution_id": "nmamit"})
    again = registry.get_or_create("S1", domain="college", bound={"institution_id": "nmamit"})
    check("same institution continues the session", first is again)

    check("another institution is refused",
          raises(ContextConflict, lambda: registry.get_or_create(
              "S1", domain="college", bound={"institution_id": "other-college"})))
    check("refusal leaves the session bound as before",
          registry.peek("S1", domain="college").bound_context == {"institution_id": "nmamit"})


def test_per_turn_context_is_applied_under_the_lock():
    registry = SessionRegistry()
    entry = registry.get_or_create("S1", domain="college", bound={"institution_id": "nmamit"})

    with registry.in_turn(entry, "en", {"institution_id": "nmamit", "area": "admissions"}):
        check("context applied for the turn", entry.context.get("area") == "admissions")
    with registry.in_turn(entry, "en", {"institution_id": "nmamit", "area": "library"}):
        check("a new QR area replaces the old one", entry.context.get("area") == "library")
    with registry.in_turn(entry, "en"):
        check("a turn without context keeps the last one", entry.context.get("area") == "library")


# =========================================================
# HTTP: AUTHENTICATED ROUTING
# =========================================================

def test_http_routes_each_token_to_its_own_runtime():
    with Service(BANK_TOKEN, COLLEGE_TOKEN) as svc:
        bank = svc.turn("deposit", token=BANK_TOKEN)
        check("banking token is served", bank.status_code == 200, bank.text)
        check("by the banking runtime", bank.json().get("reply") == "banking:deposit")
        check("response names banking", bank.json().get("domain") == "banking")

        college = svc.turn("admission documents", session="C1", token=COLLEGE_TOKEN, context=NMAMIT)
        check("college token is served", college.status_code == 200, college.text)
        check("by the college runtime", college.json().get("reply") == "college:admission documents")
        check("response names college", college.json().get("domain") == "college")

        check("each runtime saw only its own turn",
              len(svc.banking.turns) == 1 and len(svc.college.turns) == 1)


def test_http_refusals():
    with Service(BANK_TOKEN, COLLEGE_TOKEN) as svc:
        r = svc.turn(token=None)
        check("no token -> 401", r.status_code == 401 and r.json().get("error") == "not_authorised", r.text)

        r = svc.turn(token="wrong")
        check("wrong token -> 401", r.status_code == 401, r.text)

        r = svc.turn(token=COLLEGE_TOKEN)
        check("college without institution -> 422 invalid_context",
              r.status_code == 422 and r.json().get("error") == "invalid_context", r.text)

        r = svc.turn(token=COLLEGE_TOKEN, context=NMAMIT, domain="banking")
        check("college token declaring banking in the body -> 403",
              r.status_code == 403 and r.json().get("error") == "domain_forbidden", r.text)

        r = svc.turn(token=BANK_TOKEN, domain_header="college", context=NMAMIT)
        check("banking token declaring college in the header -> 403", r.status_code == 403, r.text)

        r = svc.turn(token=BANK_TOKEN, domain_header="insurance")
        check("unknown domain -> 422 unknown_domain",
              r.status_code == 422 and r.json().get("error") == "unknown_domain", r.text)

        r = svc.turn(token=BANK_TOKEN, context={"institution_id": "nmamit"})
        check("college context in a banking turn -> 422", r.status_code == 422, r.text)

        r = svc.turn(token=COLLEGE_TOKEN, context={**NMAMIT, "student_id": "x"})
        check("unknown context key -> 422 (model forbids extras)", r.status_code == 422, r.text)

        check("no refused request reached any runtime",
              not svc.banking.turns and not svc.college.turns)
        check("no refused request created a session", len(main.registry) == 0)

        check("refusals never echo the token", all(
            BANK_TOKEN not in x and COLLEGE_TOKEN not in x
            for x in (svc.turn(token=COLLEGE_TOKEN, domain="banking").text,
                      svc.turn(token="wrong").text)))


def test_http_unavailable_domain_never_falls_back_to_banking():
    with Service(BANK_TOKEN, COLLEGE_TOKEN, college_available=False) as svc:
        r = svc.turn("fees", token=COLLEGE_TOKEN, context=NMAMIT)
        check("unavailable college -> 503 domain_unavailable",
              r.status_code == 503 and r.json().get("error") == "domain_unavailable", r.text)
        check("banking runtime was not used", not svc.banking.turns)
        check("no session left behind", len(main.registry) == 0)


def test_http_sessions_are_isolated_between_domains():
    with Service(BANK_TOKEN, COLLEGE_TOKEN) as svc:
        svc.turn("deposit", session="SAME", token=BANK_TOKEN)
        svc.turn("fees", session="SAME", token=COLLEGE_TOKEN, context=NMAMIT)

        check("same id, two sessions", len(main.registry) == 2)
        bank_entry = main.registry.peek("SAME", domain="banking")
        college_entry = main.registry.peek("SAME", domain="college")
        check("different conversations", bank_entry.conversation is not college_entry.conversation)

        headers = {"X-Internal-Token": COLLEGE_TOKEN}
        snap = svc.client.get("/sessions/BANKONLY/snapshot", headers=headers)
        svc.turn("deposit", session="BANKONLY", token=BANK_TOKEN)
        snap = svc.client.get("/sessions/BANKONLY/snapshot", headers=headers)
        check("college cannot see a banking-only session", snap.json().get("known") is False, snap.text)
        snap = svc.client.get("/sessions/BANKONLY/snapshot", headers={"X-Internal-Token": BANK_TOKEN})
        check("banking still sees it", snap.json().get("known") is True, snap.text)

        gone = svc.client.delete("/sessions/BANKONLY", headers=headers)
        check("college cannot end a banking session", gone.json().get("removed") is False, gone.text)
        check("banking session still there", main.registry.peek("BANKONLY") is not None)

        offer = svc.client.post("/sessions/BANKONLY/assistance", json={}, headers=headers)
        check("college assistance sees no banking session",
              offer.json().get("reason") == "unknown_session", offer.text)


def test_http_institution_cannot_change_mid_session():
    with Service(BANK_TOKEN, COLLEGE_TOKEN) as svc:
        first = svc.turn("hello", session="C1", token=COLLEGE_TOKEN, context=NMAMIT)
        moved = svc.turn("hello", session="C1", token=COLLEGE_TOKEN, context={"institution_id": "other-college"})
        check("first turn served", first.status_code == 200, first.text)
        check("switching institution -> 409 context_conflict",
              moved.status_code == 409 and moved.json().get("error") == "context_conflict", moved.text)
        check("the refused turn did not run", len(svc.college.turns) == 1)

        area = svc.turn("where is the library", session="C1", token=COLLEGE_TOKEN,
                        context={"institution_id": "nmamit", "area": "library"})
        check("changing area within the institution is allowed", area.status_code == 200, area.text)
        check("the session records the new area",
              main.registry.peek("C1", domain="college").context.get("area") == "library")


def test_http_legacy_banking_contract_without_tokens():
    with Service("", "") as svc:
        r = svc.turn("deposit")
        check("pre-domain request (no token, no domain) is served", r.status_code == 200, r.text)
        check("as Banking, exactly as before", r.json().get("reply") == "banking:deposit")

        r = svc.turn("fees", session="C1", domain_header="college", context=NMAMIT)
        check("a declared college request is College, not Banking",
              r.status_code == 200 and r.json().get("domain") == "college", r.text)

        r = svc.turn("fees", session="C2", domain_header="insurance")
        check("unknown domain still refused in development", r.status_code == 422, r.text)


def test_http_tts_checks_the_domain_before_synthesis():
    with Service(BANK_TOKEN, COLLEGE_TOKEN) as svc:
        r = svc.client.post("/tts", json={"text": "hi", "language": "en"},
                            headers={"X-Internal-Token": COLLEGE_TOKEN, "X-Assistant-Domain": "banking"})
        check("tts with a mismatched domain -> 403", r.status_code == 403, r.text)
        r = svc.client.post("/tts", json={"text": "hi", "language": "en"})
        check("tts without a token -> 401", r.status_code == 401, r.text)


def test_health_reports_domains_without_building_runtimes():
    with Service("", "") as svc:
        body = svc.client.get("/health").json()
        check("health lists both domains", set(body.get("domains", {})) == {"banking", "college"}, str(body))
        check("college not built by a health check", body["domains"]["college"] == "registered", str(body))
        check("existing health fields unchanged",
              {"status", "models_loaded", "active_sessions"} <= set(body))


# =========================================================
# CONCURRENCY
# =========================================================

def test_concurrent_banking_and_college_turns_stay_apart():
    with Service(BANK_TOKEN, COLLEGE_TOKEN) as svc:
        auth = main.domain_auth()
        errors = []

        def run(index):
            try:
                if index % 2:
                    caller = Caller(auth, auth.authenticate(COLLEGE_TOKEN))
                    request = TextTurnRequest(session_id=f"S{index % 4}", language="en",
                                              text=f"c{index}", context=NMAMIT)
                    expected = "college"
                else:
                    caller = Caller(auth, auth.authenticate(BANK_TOKEN))
                    request = TextTurnRequest(session_id=f"S{index % 4}", language="en", text=f"b{index}")
                    expected = "banking"
                response = main.text_turn(request, caller=caller)
                if response.domain != expected or not response.reply.startswith(expected + ":"):
                    errors.append((index, response.domain, response.reply))
            except Exception as error:  # noqa: BLE001
                errors.append((index, repr(error)))

        threads = [threading.Thread(target=run, args=(i,)) for i in range(40)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        check("40 concurrent turns, every one served by its own domain", not errors, str(errors[:3]))
        check("banking runtime saw only banking text", all(t.startswith("b") for _, t in svc.banking.turns))
        check("college runtime saw only college text", all(t.startswith("c") for _, t in svc.college.turns))
        bank_convs = {c for c, _ in svc.banking.turns}
        college_convs = {c for c, _ in svc.college.turns}
        check("no conversation object served both domains", not (bank_convs & college_convs))


def main_():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("DOMAIN RESOLUTION AND ISOLATION TESTS (Phase 2)")
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
    sys.exit(main_())
