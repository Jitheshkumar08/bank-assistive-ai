# College campus maps (production)

Campus navigation directs students **only** from the maps listed in
`manifest.json`. This collection is empty: until an institution supplies and
verifies its own map, every navigation request answers "I don't have verified
directions … yet" and nothing is improvised.

## Adding an institution's map

1. Write `maps/<institution-id>.json` (format: `app/navigation/campus_map.py`):
   - `places`: one entry per place a student can be directed to. `id` must be
     the QR **area slug** printed on that place's CampusGuide QR code
     (`campusguide:college/<institution>?area=<slug>`), so the scanned code
     identifies where the student is standing.
   - `names` / `aliases`: how students say it (English required; Kannada and
     Hindi optional, written by the institution).
   - `routes`: for each origin → destination pair you support, the steps
     **as walked and checked on site**. Routes are never reversed, chained or
     generated: a pair that is not written here has no directions.
2. Add the manifest entry with `document_type: "campus_map"`, the official
   `source` and `source_reference`, `version`, and `verified: false`.
3. After someone at the institution walks every route and confirms it, set
   `verified: true`, `verified_by`, `verified_on` (YYYY-MM-DD) and the file's
   `sha256` (`python -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" maps/<file>`).
   Editing the file afterwards invalidates the checksum and the collection
   refuses to load until it is re-verified.

Synthetic fixtures (`debugging/fixtures/college_campus/`) can never be marked
verified and are never used in production.
