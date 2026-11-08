# College knowledge collection

This is the **production** College collection. It is intentionally empty: no
official institutional documents have been supplied yet, and nothing here may
be invented. Until documents are added, every College knowledge question is
answered with "I don't have that information" and recorded (redacted) in
`language_engine/runtime/unanswered/college.jsonl`.

Synthetic documents used by the tests live in
`language_engine/debugging/fixtures/college_kb/` and are never loaded from here.

## Adding an official document

1. Put the text, as Markdown, under `documents/<institution_id>/`, e.g.
   `documents/nmamit/admission_documents.md`. Use `# Title` and `## Section`
   headings (each section is retrieved on its own). Copy facts exactly from
   the official source; do not summarise dates, fees or eligibility rules.
2. Add an entry to `manifest.json`:

   ```json
   {
     "id": "nmamit-admission-documents-2026-27",
     "path": "nmamit/admission_documents.md",
     "domain": "college",
     "institution_id": "nmamit",
     "category": "admission_documents",
     "document_type": "official_notice",
     "title": "Documents required for admission 2026-27",
     "source": "verified_institution_document",
     "source_reference": "https://… or the circular number",
     "version": "2026-27",
     "language": "en",
     "verified": true,
     "verified_by": "Full name, role",
     "verified_on": "YYYY-MM-DD",
     "sha256": "<python -m app.knowledge.ingest --domain college --hash nmamit/admission_documents.md>"
   }
   ```

   Categories: overview, programmes, admission_process, admission_eligibility,
   admission_documents, application_deadlines, fees, scholarships, hostel,
   transport, departments, academic_calendar, examinations, facilities,
   office_locations, contacts, student_services, faq.

3. Only a person who has compared the file with the official source sets
   `verified: true`, with their name and the date. Editing the file later
   invalidates the recorded `sha256`; the collection then refuses to load
   until it is re-checked and the hash updated. A document with
   `verified: false` is never used in production.
4. Validate and pre-build embeddings (only new or changed text is encoded):

   ```bash
   python -m app.knowledge.ingest --domain college
   ```

The fee schedule in `college-domain/backend/data/fee-schedules/` is still
`PENDING` confirmation and is deliberately **not** in this collection.
