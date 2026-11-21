# College workflows

Workflow definitions for the College domain, in the engine's existing workflow
format (`app/workflow/loader.py`: a `workflow` name and an ordered `steps`
list with `step`, `instruction` and optional `field`). Banking workflows live
in `app/workflow/workflows/` and are never loaded for College.

College steps add a `kind`, executed by `app/workflow/domain_runner.py`:

| kind | what the step does | where its content comes from |
|---|---|---|
| `knowledge` | answers `question` | the institution's **verified** knowledge, `categories` only |
| `destination` | asks where to go (`field: destination`) | names in the institution's **verified** campus map |
| `directions` | reads the route one step at a time | the verified route written for that exact origin and destination |
| `backend_action` | asks the College backend to do `action`; accepts back only one of `outcomes` | the College backend (records never reach the engine) |

Every English sentence here must be in `app/domains/college/responses.py`
(rendered in Kannada and Hindi there); a test enforces it.

| file | started by intent |
|---|---|
| `admission_guidance.json` | `admission_process` |
| `admission_status.json` | `admission_status` |
| `campus_navigation.json` | `campus_navigation` |
