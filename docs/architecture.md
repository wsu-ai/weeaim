# WEEAIM — Architecture

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router, Turbopack), React, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | FastAPI (Python 3.12), SQLAlchemy (async), asyncpg, Alembic, Pydantic settings |
| Transactional DB | PostgreSQL 16 |
| Vector search | PostgreSQL + pgvector (same instance) |
| Object storage | Encrypted object-storage adapter (S3/Blob/GCS in prod, local filesystem adapter for dev) |
| Queue / background jobs | Redis + Celery |
| AI interface | Provider-abstracted (see below); OpenAI Responses API and Anthropic supported |
| Package manager (JS) | pnpm, pinned via Corepack (`packageManager` field in `package.json`) |
| Dev tooling | Claude Code (VS Code extension) — Plan mode for design/schema/infra decisions, Manual mode to implement approved plans |
| Local infra | Docker Compose (Postgres 16 + pgvector image, Redis 7) |

Cloud deployment target (AWS/Azure/GCP) is intentionally undecided and kept
behind interfaces. Authentication uses Sign in with Google (invite-only; see
`docs/google-sign-in.md`). It sits behind `get_auth_context`
(`backend/app/auth.py`), so another identity provider could be added later
without touching business logic.

## AI provider abstraction

An `AIProvider` interface exposes the operations the app needs, independent of
which model/vendor backs it:

- `structure_idea` — free text → structured idea schema
- `create_research_plan` — what evidence/calculations a stage needs
- `analyze_evidence` — synthesize claim/evidence records with confidence and
  supporting/contradicting sources
- `produce_report` — assemble the cited output for a stage or final report

Concrete implementations (e.g. an OpenAI-backed provider, an Anthropic-backed
provider) sit behind this interface. No application code should call a vendor
SDK directly outside the provider implementation.

## Stage 1 idea research (web search)

Stage 1 (Idea Discovery) gives the founder an expert view of the idea before
they structure it further.

**The request:**
`POST /api/ventures/{id}/stages/idea_discovery/research` (`app/routers/wizard.py`)
calls `AIProvider.research_idea`. `OpenAIProvider` uses the Responses API with
OpenAI's built-in `web_search` tool and a schema-validated `IdeaResearch`
output (`app/ai/schemas.py`). That output covers:
- existing businesses and solutions, each a direct, partial or adjacent match
- a qualitative market status (no numeric score)
- feasibility and viability
- where to differentiate
- risks and next steps

**Deterministic post-processing** (`app/wizard/idea_research.py`):
- Sources come only from the search tool's `url_citation` annotations, not
  from links in the model's text.
- Each business's official website (which the model is asked to find) is
  linked only if the search actually cited or consulted that site; the
  consulted pages are requested with `include=["web_search_call.action.sources"]`.
  Every business also gets a web-search link as a fallback.
- **Degree of Feasibility** is computed by app code, not the model. The model
  rates five fixed factors (technical complexity, resources required,
  regulatory barriers, time to market, customer access) as favorable,
  moderate or challenging. `feasibility_score()` maps these to 100, 60 or 20
  and averages them with equal weights. The UI shows the breakdown.
- Only `http`/`https` links are allowed.

**Storage:**
- The result goes in `wizard_responses.ai_analysis` with
  `kind: "idea_research"`, and the stage's status becomes `awaiting_user`.
- Every run, including failures, is logged in `ai_runs`, so earlier research
  survives a re-run.
- The frontend panel (`components/idea-research-panel.tsx`) runs the research
  automatically the first time Stage 1 is opened.
- Output is written in the page language (`en` or `ko`).

## Stage prerequisites and Stage 4 alternatives research

**Prerequisites:** `STAGE_PREREQUISITES` (`app/wizard/stages.py`) locks a
stage until listed earlier stages are `completed`. Stage 4 (Existing
Alternatives) needs stages 1–3.
- `GET /stages` reports `locked` and `locked_by`.
- Saves, research and feedback on a locked stage return 409.
- Editing an earlier stage takes it out of `completed`, and the existing
  "needs revision" rule does the same to later completed stages. So Stage 4
  re-locks until they're completed again, while its saved answers and
  research are kept.

**Research:**
- `POST /stages/existing_alternatives/research` builds its context from the
  founder's stage 1–3 answers and the Stage 1 research summary
  (`app/wizard/alternatives_research.py`). It then calls
  `AIProvider.research_alternatives`, using the same web-search, citation and
  link-check machinery as Stage 1.
- Output (`AlternativesResearch`):
  - alternatives grouped as direct competitors, indirect competitors,
    substitutes and workarounds
  - switching barriers and unmet needs
  - positioning advice and next steps
  - a `based_on` timestamp for the stage 1–3 answers it used
- Runs are logged in `ai_runs` (`alternatives_research`) and listed by
  `GET /stages/{slug}/research/history`. The research and history endpoints
  are shared with Stage 1.

## Backend evidence pipeline (per relevant wizard stage)

1. **Idea structuring** — schema extraction from free text
2. **Research planning** — determine what internal/external evidence and
   calculations are needed
3. **Parallel evidence collection** — specialist workers (customer-problem,
   market, competitor, technology, regulatory, business-model, financial,
   evidence-critic)
4. **Evidence synthesis** — claim/evidence records with confidence and
   supporting/contradicting sources
5. **Scoring** — deterministic, weighted calculation in application code, never
   left to the model to invent

## RAG / retrieval

Every document chunk carries `organization_id`, `venture_id`, `classification`,
and `allowed_roles` metadata. Tenant/permission filters are applied **before**
similarity search — never "retrieve broadly and filter after."
