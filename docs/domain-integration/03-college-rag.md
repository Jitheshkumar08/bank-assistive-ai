# Phase 3 — College knowledge collection (RAG)

College gets its own knowledge collection, searched one institution at a time,
on the engine's existing retrieval stack. Banking retrieval is unchanged. The
collection is wired into College answers in Phase 4 (College runtime).

## What is reused, unchanged

`KnowledgeRetriever` (app/knowledge/retriever.py): section chunking, scoring
(mean of whole-article and best-section similarity), ranking and its
`search(query, top_k)` contract; the shared `paraphrase-multilingual-MiniLM-L12-v2`
encoder. Two optional constructor additions, both unused by Banking:
`encoder=` (cached document vectors) and per-document `metadata` returned with
results. Banking's retriever output is byte-identical to the baseline
(`test_retriever`, incl. its printed scores).

## New pieces (app/knowledge/)

| Module | Role |
|---|---|
| `collection.py` | Loads and validates a domain's `manifest.json`; selects documents by domain → institution → verified → category |
| `domain_retrieval.py` | `DomainKnowledgeBase`: one retriever per institution, answerability gate, isolation guard, unanswered logging; `InstitutionKnowledge` exposes the `search()` contract |
| `embedding_cache.py` | Content-hash (SHA-256) vector cache per collection; only new/edited text is encoded; stale vectors pruned |
| `unanswered_log.py` | Redacted JSONL of unanswerable questions |
| `ingest.py` | `python -m app.knowledge.ingest --domain college [--check \| --hash PATH]` |

## Collections

| Domain | Location | Content |
|---|---|---|
| Banking | `app/knowledge/documents/` (unchanged) | 15 articles, built-in loader |
| College (production) | `app/domains/college/knowledge/` | **Empty** — no official documents supplied yet. See its README for how to add one |
| College (tests only) | `debugging/fixtures/college_kb/` | 11 **synthetic** documents for two fictional institutions (`test-institute-a`, `test-institute-b`); every entry `verified: false`, `document_type: synthetic_fixture`, each file bannered "SYNTHETIC TEST FIXTURE" |

The NMAMIT fee schedule (`college-domain/backend/data/fee-schedules/`) stays
`PENDING` and is not in any collection.

## Guarantees

- **Domain isolation.** A manifest entry of another domain, an absolute path,
  `..`, or any path outside the collection's own `documents/` is refused, so a
  College collection cannot list a Banking article. Banking's loader reads only
  its own directory.
- **Institution isolation by construction.** Each institution's retriever is
  built only from that institution's documents; another institution's text is
  never encoded into it. Every result is re-checked on the way out
  (`IsolationError`).
- **Verified only.** Production selects `verified: true` documents only;
  `include_unverified` is a constructor argument used by the tests, not an
  environment setting. A verified entry needs `source_reference`,
  `verified_by`, `verified_on` and the file's `sha256`; editing the file
  invalidates the manifest until it is re-checked. Synthetic fixtures can never
  be verified.
- **Source attribution.** Results carry `metadata` (id, institution, category,
  document type, title, source, reference, version, verified).
- **Answerability.** Unanswerable when the institution has no (selectable)
  documents, the category asked about has none, or the best score is below
  `min_score`; nothing is returned and the question is logged.
- **Unanswered log** (`language_engine/runtime/unanswered/<domain>.jsonl`,
  git-ignored; `UNANSWERED_LOG_DIR`, `off` disables): timestamp, domain,
  institution, category, reason, score, SHA-256 of the question, and the
  question with e-mails and 3+-digit numbers replaced, cut to 200 characters.
  No session/user identifiers.
- **No rebuild on start-up.** Vectors are cached in
  `language_engine/.cache/embeddings/` (git-ignored; `KNOWLEDGE_CACHE_DIR`).

## The threshold is provisional

`MIN_SCORE = 0.30` (app/domains/college/config.py), measured on the synthetic
fixtures: off-domain questions ≤ 0.281, answerable ≥ 0.325, but a near-topic
question with no document scored 0.723 ("When are the semester examinations?"
against the calendar). As retriever.py records for Banking, no threshold
separates near-topic from answerable; those are handled by category narrowing
(the College intent supplies the category, Phase 4) and the answer prompt's
"say you do not have that information" rule. Re-measure on official documents.

## Known limitations

- Kannada questions rely on the multilingual encoder alone; Banking's query
  glossary is not applied to College (a College glossary belongs with Phase 4/8).
  On fixtures, Kannada questions scored 0.33–0.61 and retrieved correctly.
- Retrieval quality has only been measured on synthetic text.

## Tests

`python -m debugging.test_college_rag` — 100 checks: manifest validation and
verification rules, fixture/production manifests, verified-only production,
source attribution, 11 English/Kannada questions, off-domain refusal, category
narrowing, institution isolation, College↔Banking isolation, isolation guard,
`search()` contract, embedding reuse / incremental add / edit / prune,
model-mismatch cache, redacted unanswered log, latency (mean 38 ms per search
on fixtures, retriever built).

Mutation checks: removing the institution filter or the verified filter is
stopped by the isolation guard; with the guard also removed, the tests fail
(11 and 3 failures).

## Regression (2026-11-06)

All 54 engine suites run one at a time: the 52 baseline suites have the same
exit codes and pass counts as the baseline, and the six summary-less suites
(incl. `test_retriever`, `test_knowledge`) print identical output. The same 7
live-LLM / interactive scripts stop for the same environmental reasons.
Banking backend unit 75/75, e2e 96/96; Banking frontend 584/584.
