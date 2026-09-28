# WEEAIM — Product Requirements

## Purpose

WEEAIM ("Woosong Evidence-based Entrepreneurship AI Model") takes a free-text business
idea and runs it through an AI-assisted, evidence-based validation process, producing
a structured feasibility assessment — not a simple good-idea/bad-idea verdict.

"Venture validation" = converting an unstructured idea into a structured hypothesis,
then gathering internal (uploaded documents) and external (approved sources) evidence
to evaluate: customer problem, target customer, market size, demand evidence,
competitors/substitutes, differentiation, business model, pricing, technical
feasibility, regulatory/legal risk, go-to-market feasibility, financial assumptions,
founder/team capability, and sustainability/social impact.

Output includes: an evidence-supported feasibility score, confidence level, sources
with publication dates, supporting/contradictory evidence, unverified assumptions,
recommended validation experiments, financial scenarios, and a go/no-go/pivot
recommendation.

## The 11-stage wizard ("WEEM")

1. Idea Discovery
2. Problem Definition
3. Customer Definition
4. Existing Alternatives
5. Value Proposition
6. Market Evidence
7. Competitive Position
8. Desirability, Feasibility, Viability (DFV) Assessment
9. Business Model
10. Validation Plan
11. Decision and Roadmap

Each stage has state `not_started → in_progress → awaiting_user → researching →
completed → needs_revision`. Users can navigate back without losing later work; if an
earlier answer changes materially, later stages are flagged "needs review" rather
than deleted.

## Other planned features

Document upload/RAG over founder materials, external research connectors
(government stats, patent/trademark DBs, academic research, competitor sites),
a validation-experiment module (pricing tests, landing pages, concierge MVP,
interviews, LOIs), auto-generated citation-backed reports, an admin dashboard,
Korean + English language support, and revision history.

## Explicitly out of scope for MVP

Subscription billing, investor marketplace, founder matching, large multi-agent
teams, automatic patent opinions, automatic investment decisions, direct
social-media publishing, fully autonomous website scraping.

## First vertical slice (build this before anything else)

Idea entry → AI structuring → user confirms → Problem / Customer / Value-Proposition
stages only → one document upload → one external source → cited evidence → a
preliminary report.

Definition of done:
- Valid AI-generated idea interpretation
- All 3 wizard stages completable, with autosave and revision history
- One uploaded document processed and retrievable
- A cited preliminary report generated
- All backend tests pass; frontend lint/test/build pass
- No `.env` file or API key in git history
- Another organization cannot retrieve the venture or its document chunks
  (automated cross-tenant leakage test returns zero unauthorized passages)

## Release gates before any pilot launch

Zero cross-tenant leakage; 100% valid structured outputs (or handled retries);
≥95% valid citations; no invented financial calculations; full auditability of
scores; successful deletion of originals + vectors on request; human review of
all evaluation cases.

## Known open decisions (not needed for the vertical slice)

Auth provider (Auth0 / Clerk / SSO) — deferred behind an interface, dev-auth
adapter used locally. Cloud provider (AWS / Azure / GCP) and data residency —
not needed until deployment. Final LLM provider — a controlled evaluation of
provider(s) against citation accuracy, hallucination rate, cost, latency, and
Korean/English performance is required before committing in production; the
provider abstraction (see `architecture.md`) exists specifically so this can be
decided later without a rewrite. Embedding model/vector dimension must be
confirmed against the actual current provider configuration before writing any
DB migration that references vector dimensions — do not hardcode a guessed value.
