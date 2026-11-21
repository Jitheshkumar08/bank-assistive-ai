"""The College (CampusGuide) domain.

Every College turn names its institution. The institution is fixed when the
session starts, so one conversation can never read another institution's
knowledge; area and location may change as the student moves around campus.

KNOWLEDGE (Phase 3)

The collection is app/domains/college/knowledge/ (manifest.json + documents/).
It is EMPTY until official documents are supplied; only documents marked
verified are ever retrieved.

MIN_SCORE = 0.30 is PROVISIONAL. Measured on the synthetic fixtures
(debugging/fixtures/college_kb, 16 answerable / 12 unanswerable questions):

    highest score, off-domain question (banking, general)    0.281
    lowest score, answerable question (incl. Kannada)        0.325
    highest score, near-topic question with no document      0.723
        ("When are the semester examinations?" vs the calendar)

So the threshold only keeps off-domain questions out; it cannot tell a
near-topic question from an answerable one, exactly as retriever.py records
for Banking. Near-topic questions are handled by narrowing retrieval to the
asked category (from the College intent, Phase 4) and by the answer prompt's
"say you do not have that information" rule. Re-measure on official
documents before relying on this value.
"""

from pathlib import Path

from app.dialogue.catalog_localizer import catalog_localizer_factory
from app.domains.base import ContextPolicy, DomainConfig, KnowledgeConfig, NavigationConfig
from app.domains.college.responses import COLLEGE_CATALOG

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"

#: College workflow definitions (Phase 5). Never Banking's folder.
WORKFLOWS_DIR = Path(__file__).resolve().parent / "workflows"

#: Verified campus maps (Phase 5): places and routes per institution. EMPTY
#: until an institution supplies and verifies its own; see campus/README.md.
CAMPUS_DIR = Path(__file__).resolve().parent / "campus"

MIN_SCORE = 0.30

COLLEGE = DomainConfig(
    id="college",
    display_name="College (CampusGuide)",
    token_env="AI_ENGINE_COLLEGE_TOKEN",
    context=ContextPolicy(
        allowed=frozenset({"institution_id", "area", "location_id"}),
        required=frozenset({"institution_id"}),
        bound=frozenset({"institution_id"}),
    ),
    knowledge=KnowledgeConfig(manifest=KNOWLEDGE_DIR / "manifest.json", min_score=MIN_SCORE),
    localizer=catalog_localizer_factory(COLLEGE_CATALOG),
    workflows_dir=WORKFLOWS_DIR,
    navigation=NavigationConfig(manifest=CAMPUS_DIR / "manifest.json"),
)
