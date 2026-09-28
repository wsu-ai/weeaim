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

Cloud deployment target (AWS/Azure/GCP) and production auth provider
(Auth0/Clerk/SSO) are intentionally undecided — both are placed behind
interfaces so the choice can be made later without touching business logic.

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
