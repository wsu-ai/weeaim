# WEEAIM — Architecture

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router, Turbopack), React, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | FastAPI (Python 3.12), SQLAlchemy (async), asyncpg, Alembic, Pydantic settings |
| Transactional DB | PostgreSQL 16 |
| Vector search | PostgreSQL + pgvector (same instance) |
| Object storage | Encrypted object-storage adapter (S3/Blob/GCS in prod, local filesystem adapter for dev) |
| Queue / background jobs | Redis + Celery (planned); stage-agent runs currently run in-process (see Stage AI agents) |
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

**External sources (Stage 1):** the button under Stage 1's Sources opens
the organization's external data APIs (`/api/external-sources`; owners/admins
manage, members view). Each is a name, an `https` URL with `{query}`, and an
optional encrypted API key sent in a chosen header. When Stage 1 researches,
every enabled source is called in parallel with the venture's title
(`app/external_sources/`), the items it returns (title, description, link,
picked out generically from the first list in the JSON) and a trimmed copy of
the raw response go to the model as untrusted data, and their links join the
research's sources (marked `via: <source>`) and its verified hosts.
`external_results` records each source's status; a failing source is skipped.
See the security model for the SSRF and key rules.

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

## Stage 6 market evidence (TAM / SAM / SOM)

Stage 6 (`market_evidence`) unlocks once stages 1–5 are completed. Its
research context (`app/wizard/market_research.py`) includes:
- the founder's stage 1–5 answers
- the Stage 1 and Stage 4 research summaries
- the founder's own beachhead segment and pricing assumption

**Three geographies:** the market is sized globally, for the founder's
country, and for their metropolitan city.
- The location comes from the Stage 6 answers `user_country` and
  `user_metro_city`. The form pre-fills them in this order: the user's
  account default (`users.default_country` / `default_metro_city`, editable
  under **Settings**), then the browser language's region for the country,
  then the browser time zone's city when it's in that country. The founder
  confirms with **Save location**, optionally saving it as their default
  (`PATCH /api/auth/me/preferences`). See `frontend/src/lib/location.ts`.
- **Settings** picks the default from dropdowns: every country
  (`frontend/src/lib/countries.ts`, ISO 3166 codes named by the browser's
  `Intl` data in the page's language, stored as the English name) and that
  country's major cities (`frontend/src/lib/cities.ts`, a built-in list,
  plus "Other" to type any city). The first time, the browser's country is
  suggested. When a saved country is changed to one whose language differs
  from the app's (Korean for South Korea, English elsewhere), the user is
  offered to switch: yes switches the app language and translates every
  venture's AI content through the cached translation endpoint
  (`frontend/src/lib/translate-all.ts`); the founder's own answers and the
  original AI content are never changed.
- Research returns 422 `location_required` until both are saved.
- `consistency_warnings` flags a city with more target customers than its
  country, or a country with more than the world.

`AIProvider.research_market` (web search) returns **inputs only**, per scope:
- vendors already doing business in the market, with traction evidence
- target demographics, with counts and sources
- four sourced bottom-up inputs: target customers, annual revenue per
  customer, serviceable share and obtainable share (shares limited to 0–1)
- published market-size figures, as a cross-check

**Market sizing is computed by app code** (`compute_market_sizes`, `Decimal`,
rounded half-up to whole currency units), never by the model, per CLAUDE.md:

```
TAM = target customers × annual revenue per customer
SAM = TAM × serviceable share
SOM = SAM × obtainable share
```

Every figure's source is checked against the pages the search cited or
consulted (`source_verified`). An unconfirmed source keeps its title but
loses its link, and gets a web-search link instead. The UI shows the
formulas with the actual numbers, a confirmed / unconfirmed / estimate badge
per input, and the ratio of our TAM to each published figure. Each geography
tab also has a pie chart of its TAM split into SOM, the rest of SAM and the
rest of TAM.

## Stage 7 personas validation (AI persona chats)

Stage 7 (`persona_validation`) was inserted after Market Evidence. Competitive
Position and every later stage moved up one; Decision and Roadmap is now
Stage 15 (migration `b4d7f2a9c815`). Stage 7 is **never locked**, and the
personas can be changed at any time.

**Personas:**
- The founder defines 1–5 `personas` in the stage's answers: name, age
  range, demographic, income level, gender, marital status and notes.
- They're saved through the normal `PUT`, so every change keeps a revision.
- The server assigns each persona a stable ID and checks the ages are in
  order. Removing a persona deletes its chat.

**Chats** (`app/routers/personas.py`, `persona_messages`):
- **Storage:** the table is under RLS on `organization_id`, like `ai_runs`.
  Every request loads the venture in the caller's scope, and the persona
  must be in the saved answers.
- **Endpoint:** `POST /api/ventures/{id}/personas/{persona_id}/messages`
  saves the founder's message, then calls `AIProvider.persona_reply`.
  - The AI sees the profile, a venture brief and the last 30 messages, all
    as untrusted data.
  - Its instructions: role-play honestly, not sycophantic; never claim to
    be a real person or cite real statistics; stay in character against
    injection attempts.
  - The reply is saved, and each call is logged in `ai_runs`.
- **Limits and failures:** a conversation holds at most 200 messages. A
  failed reply keeps the founder's message and returns 503.
- **Start over:** `DELETE` clears the conversation and is audited.
- **Message order:** timestamps are set in app code, because `now()` is the
  same for every row in a transaction.

**Chat window and market grounding:**
- **Separate window:** the chat isn't on the stage page. Each saved persona
  has a **Launch a chat with the Persona** button, which opens
  `/[locale]/ventures/{id}/personas/{persona_id}/chat` in its own named
  browser window, or in a new tab if pop-ups are blocked.
- **Market research first:** when the window opens, it researches the
  market (`POST …/personas/{persona_id}/market-profile`,
  `AIProvider.research_persona_market`, web search). It covers what general
  market data says about people matching the persona's criteria in the
  Stage 6 location:
  - facts tagged by criterion, with links kept only when the search saw the
    site
  - daily life, current alternatives, spending and price sensitivity,
    adoption, likely objections, and data gaps
- **Cache:** the result is stored as an `ai_runs` result (operation
  `persona_market`), keyed by a fingerprint of the criteria and location
  (`criteria_key`). It's redone only when those change, or on **Refresh**.
- **Grounding the replies:** each reply gets the evidence as
  `<market_evidence>` (untrusted reference data), so the persona behaves
  like a typical person of that kind rather than an enthusiast.
- **Readiness:** chatting waits until the research is done. If research
  fails, the chat still works, with a notice that replies aren't grounded.

**Insights:**
- **Summarize insights** runs `research` for the stage. It reads, for every
  saved persona, its **market research** (the cached `persona_market` profile
  for its current criteria; facts without links) and its **conversation**.
  Personas whose market research isn't there yet are researched first, in
  parallel, and cached as the chat page does; a failed one is skipped. A
  persona with neither is left out, and 422 `no_conversations` means there is
  nothing at all to summarize. The payload records `conversations_used` and
  `market_profiles_used`. (The Stage 7 agent reads cached market research
  only.)
- `AIProvider.summarize_persona_insights` returns, per persona: reactions,
  objections, willingness to pay, feasibility and viability signals, and
  quotes. App code keeps a quote only if it appears **word for word** in
  that persona's replies.
- It also returns assumptions to test with real customers.
- **Labelling:** everything is marked as simulated, in the payload
  (`simulated: true`) and in the UI.
- **Later stages:** the personas and insights join `earlier_research()`, so
  Stages 8–14 see them. The deck's "Target customers" slide lists them.

## Stage 8 competitive position and action items

Stage 7 (`competitive_position`) unlocks once stages 1–6 are completed. It
**synthesizes** a position from what earlier stages produced, rather than
running a new market study (`app/wizard/competitive_position.py`):
- The founder's stage 1–6 answers go in as untrusted user input.
- The saved Stage 1, 4 and 6 research (summaries, existing solutions,
  alternatives with strengths and weaknesses, unmet needs, vendors, and the
  **app-computed** TAM/SAM/SOM) goes in a delimited `<research_data>` block
  as untrusted reference data. A closing tag inside the data is neutralized,
  so web text can't end the block early.
- `AIProvider.research_competitive_position` uses web search only to confirm
  facts about competitors already named. It is told not to compute or state
  any new market or financial figure.

The output is schema-validated (`CompetitivePosition`):
- a positioning statement, target segment and market category
- a competitor comparison (their position, our advantage, our gap)
- differentiators, each with evidence and the stage it came from
- risks and defensibility
- 3–10 action items, each with why, steps, priority, timeframe and success
  metric

App code gives each action a stable `id` (a hash of its normalized title),
keeps competitor links only when the search saw that site, and stores every
run in `ai_runs`.

**Action checklist:** ticks are saved as `completed_actions` in the Stage 7
answers through the normal `PUT`, so every tick keeps a revision. A save that
changes only progress fields (`PROGRESS_FIELDS` in `app/wizard/stages.py`)
keeps the stage's status and doesn't send later stages back for revision.

## Stage 9 DFV assessment (desirability, feasibility, viability)

Stage 8 (`dfv_assessment`) is **never locked**: founders can run it at any
time. Missing or incomplete stages reach the model as missing evidence, and
it is told to rate the affected criteria accordingly and name the gap. It
judges the evidence already gathered, so it makes **no web search**: one
schema-validated call, `AIProvider.assess_dfv` (`app/wizard/dfv_assessment.py`).
- The founder's stage 1–7 answers go in as untrusted user input.
- The earlier research goes in the same untrusted `<research_data>` block as
  Stage 7, plus Stage 1's feasibility factors and the Stage 7 position, with
  which of its action items are done.

**Twelve fixed criteria**, one required schema field each, so none can be
skipped:

| Dimension | Criteria |
|---|---|
| Desirability | problem severity, evidence of demand, willingness to pay, appeal of the difference |
| Feasibility | technical complexity, resources and team, regulatory barriers, time to market |
| Viability | market size, revenue model, unit economics, defensibility |

For each criterion the model gives:
- a rating: strong, moderate or weak
- a reason
- the evidence, and the stage it came from
- what evidence is missing

It also lists assumptions to test and 3–10 action items, each tagged with the
dimension and criterion it strengthens. **It never gives a score.**

**Scores and verdict are computed by app code** (CLAUDE.md):

```
criterion points: strong 100, moderate 60, weak 20
dimension score  = average of its 4 criteria (whole %, rounded half-up)
overall          = average of the 3 dimension scores
verdict          = proceed if every dimension >= 70; rethink if any < 40;
                   otherwise strengthen
```

The action items use the same checklist as Stage 7: shared ID helper
`app/wizard/actions.py`, shared `ActionChecklist` component, and
`completed_actions` as a progress field.

## Stage 10 minimum viable product (MVP / service)

Stage 9 (`mvp`) was inserted between the DFV assessment and the business
model: migration `c8f4a2d6e391` moved Business Model and later stages up by
one. Responses reference stages by id, not number, so existing data was
unaffected. Stage 9 is **never locked**.

`AIProvider.research_mvp` (`app/wizard/mvp.py`) makes one schema-validated
call with no web search. It uses the founder's stage 1–8 answers, plus
Stage 8's untrusted `<research_data>` block with its scores and weak criteria.

The schema (`MvpConcept`) has an `offering_type` and exactly one matching
detail section. A validator requires that section and drops any other.

| Offering type | What the founder sees |
|---|---|
| `physical_product` | A **concept image**: a second call, `generate_product_image`, to the OpenAI image API (`OPENAI_IMAGE_MODEL`, default `gpt-image-1`; 1024², WebP), plus materials, dimensions, components and a prototype route |
| `online_service` | A **sample landing page**, drawn by the app's `WebsiteMockup` component from structured content: brand, colours, hero, CTA, features, how it works, pricing teaser. The model never writes HTML, so no untrusted markup or script reaches the browser |
| `offline_service` | A **service description**: overview, customer journey, delivery (where, who, when), what the customer gets, resources needed, pricing |

**Checks in app code:**
- **Colours** must be `#rrggbb`; anything else is replaced with a safe
  default, both server-side and again before reaching a `style`. Text colour
  on brand colours is picked by WCAG contrast.
- **Mockup text** is cut to the lengths the layout fits.
- **Offering type:** the founder can override it (`MvpAnswers.offering_type`,
  a selector in the panel). The override is passed to the model, and
  `offering_type_source` records who chose.

**Image handling:**
- **Storage:** images are stored in `venture_assets`, under the same RLS as
  `ai_runs`, and never inlined in `ai_analysis`, which keeps stage lists small.
- **Checks:** the type comes from the file's own signature, which must be
  WebP, PNG or JPEG, and the size limit is 5 MB.
- **Serving:** only through `GET /api/ventures/{venture_id}/assets/{asset_id}`,
  which loads the venture in the caller's RLS scope and matches the asset to
  that venture. It is sent with `nosniff` and `Cache-Control: private`.
- **Logging and failures:** each image run is its own `ai_runs` row
  (`mvp_image`, without the bytes). A failed image keeps the concept and sets
  `image_failed`.
- **Deletion:** deleting a venture deletes its assets.


**Design Studio** (`/ventures/{id}/design-studio`, opened from the button
below the website mock-up): the founder edits the mock-up (brand, colours,
menu, headline, button, 2-6 features with icons, steps, pricing and footer
lines) with a live preview drawn by the same `WebsiteMockup` component. The
result is saved in the stage's answers as `mockup_design` (`MockupDesign`,
validated: #RRGGBB colours, known icons, length limits) through the normal
stage save, so revisions are kept; it is a progress field, so saving a design
keeps the stage's status. The AI's original stays in `ai_analysis`; Stage 10
shows the founder's design with a toggle back to the original, and the studio
can start over from it.

## Stage 11 business model and unit economics

Stage 10 (`business_model`) is **never locked**, like Stages 8 and 9. It
recommends the business model with the strongest fit to the evidence from
stages 1–9 (`app/wizard/business_model.py`):
- Context: the founder's stage 1–9 answers, plus the untrusted
  `<research_data>` block from Stage 8, extended with the Stage 8 scores,
  verdict, weak and moderate criteria with their gaps, and assumptions to
  test, plus the Stage 9 MVP concept. Missing stages count as missing
  evidence.
- `AIProvider.research_business_model` uses a light web search, only for
  pricing, cost-to-serve, acquisition-cost and churn benchmarks of comparable
  businesses.

The output is schema-validated (`BusinessModel`):
- the recommended model and type, with reasons tagged by the stage they rest
  on, and 2–3 alternatives set aside (why not, and when each would fit)
- all nine Business Model Canvas blocks, a pricing strategy, and tiers
- launch KPIs and key risks
- 3–12 **things to complete**, each tagged with an area: customers,
  offering, go-to-market, operations, finances or validation
- **unit-economics inputs only**: monthly revenue per customer, monthly cost
  to serve, acquisition cost, and monthly churn (above 0, at most 1). Each is
  sourced or marked as an estimate, and sources are checked like Stage 6's.

The model gives no probability of success and no derived figures.

**Unit economics are computed by app code** (`unit_economics()`, `Decimal`,
rounded half-up), per CLAUDE.md:

```
contribution  = revenue - cost to serve           margin = contribution / revenue
lifetime      = 1 / monthly churn (months)        LTV    = max(contribution, 0) x lifetime
LTV:CAC       = LTV / CAC                         payback = CAC / contribution (never if <= 0)
```

Health checks (`health_checks()`) apply fixed thresholds:

| Check | Healthy | Watch | Unhealthy |
|---|---|---|---|
| LTV:CAC | 3 or more | 1 to under 3 | under 1 |
| CAC payback | 12 months or less | over 12, up to 24 | over 24, or never |
| Contribution margin | 50% or more | 20% to under 50% | under 20% |

The things to complete are a checklist (`completed_actions`, a progress
field), the same as Stages 7 and 8.

## Stage 12 validation plan and result evaluation

Stage 11 (`validation_plan`) is **never locked**. `AIProvider.plan_validation`
(`app/wizard/validation_plan.py`) makes one schema-validated call with no web
search. Its context is:
- the founder's stage 1–10 answers
- the untrusted `<research_data>` block: Stage 8's data and assessment, the
  Stage 9 MVP, and Stage 10's model, including **which unit-economics inputs
  are estimates**, its health checks, and its things to complete

The plan (`ValidationPlan`) contains:
- **prerequisite fixes**: contradictions in earlier stages to resolve first
- the **riskiest assumptions**
- **3–8 experiments**, each with:
  - one metric and a comparator (`at_least` / `at_most`)
  - a numeric `pass_threshold`, and an optional `fail_threshold`
  - a `critical` flag and a phase
- decision rules and ethics checks

The bars are set before any result exists. The model never states an
outcome. App code assigns stable experiment IDs, and drops a fail bar that
sits on the wrong side of the pass bar.

**The founder records results; app code evaluates them** (CLAUDE.md):

```
at_least:  value >= pass -> passed;  value <= fail -> failed;  between -> inconclusive
           (no fail bar: anything below pass -> failed)
at_most:   the mirror image          no value -> not_run
decision:  any critical failed -> stop_or_pivot;  all critical passed -> proceed;
           otherwise keep_testing;   no results -> not_started
```

**Where the results live:**
- **Saved results:** `experiment_results` in the stage's answers.
- **Server-computed fields:** `experiment_outcomes` and `decision_signal` are
  recomputed from the saved plan by `finalize_answers()`, on every `PUT` and
  after every Refresh. Values sent by a client are always replaced.
- **Removed experiments:** a result for an experiment no longer in the plan
  is kept, but not evaluated.
- **Status:** all three are progress fields, so recording a result keeps the
  stage's status.

## Stage 13 financial analysis (36-month projection)

Stage 12 (`financial_analysis`) was inserted before Decision and Roadmap,
which became Stage 13 (migration `e4b8c2a7f159`). It is **never locked**.

**The AI drafts inputs only.** `AIProvider.draft_financials` (no web search)
uses the founder's stage 1–11 answers, plus the untrusted `<research_data>`
block: the Stage 6 market sizes, the Stage 9 MVP, the Stage 10 pricing and
unit-economics inputs, and the Stage 11 experiments. It returns
`FinancialInputs`:
- revenue drivers: price, launch customers, new customers in month 1 and
  their monthly growth, churn, variable cost per customer, and acquisition
  cost, each flagged as an estimate or not
- **fixed costs**: salaries, rent, software, insurance, legal and accounting,
  utilities
- **operating costs**: marketing, AI or cloud, payment fees (as a % of
  revenue), travel, support
- **one-time startup costs**
- funding, tax rate and discount rate

It is told not to state any total or metric.

**The founder edits the inputs** in the panel's tables, and the inputs are
saved in the answers (`financial_inputs`):
- **Refresh** keeps the founder's edited inputs. Inputs never touched follow
  the new draft (`inputs_source`).
- **Reset to AI draft** saves the draft back.

**Every figure is computed by app code** (`app/wizard/financials.py`,
`Decimal`), on every save and every Refresh, and stored as `projection`.
Values sent by a client are ignored.

```
customers[m] = customers[m-1] x (1 - churn) + new1 x (1 + growth)^(m-1)
EBITDA = revenue - (variable + acquisition + fixed + operating + one-time)
tax = max(EBITDA, 0) x rate (simplified);  net = EBITDA - tax
cash[m] = starting cash + planned raise (from its month) + cumulative net
```

**Metrics:**

| Metric | Definition |
|---|---|
| Burn rate | Average net outflow over months 1–6, plus the peak month |
| Runway | Whole months before the cash first goes negative ("beyond 36" if never) |
| Operating break-even | First month from which EBITDA stays at 0 or above |
| Break-even customers | ⌈(fixed + flat operating costs) ÷ (price × (1 − % fees) − variable cost)⌉ |
| Cash payback | First month from which the cumulative net cash flow stays at 0 or above |
| Funding needed | The deepest cash shortfall |
| NPV | The monthly net cash flows, discounted at the annual rate |
| IRR | **Project IRR** of the monthly net cash flows, by bisection, annualized; none without a sign change. **No exit or terminal value** |

**Warnings:**
- each customer loses money
- the cash runs out before break-even
- a cost row is 0
- churn is 0

The panel shows:
- **KPI tiles**
- **two inline-SVG line charts**: cash balance with a runway marker, and
  revenue vs total costs. They follow the dataviz rules: validated palette
  slots, 2px lines, a hairline grid with a zero line, a legend plus end
  labels, and a crosshair tooltip that also works from the keyboard.
- **yearly and monthly tables** (the table view)
- **the input editor**

## Stage 14 marketing plan and the venture deck

Stage 13 (`marketing_plan`) was inserted after Financial Analysis; Decision
and Roadmap became Stage 14 (migration `f6c1d9e3a274`). It is **never
locked**.

`AIProvider.research_marketing_plan` (`app/wizard/marketing_plan.py`) uses a
light web search, only to find the channels and platforms the target
customers use in the target market, and typical costs there. Its context is
the founder's stage 1–12 answers, plus the untrusted `<research_data>` block:
- the positioning and competitor comparison, and the alternatives
- the customers, market and location, and the MVP
- the pricing
- **Stage 12's monthly marketing costs**

The plan contains:
- personas
- key messages, each naming the alternative it counters and its proof point
- differentiators
- 3–8 channels, each with a type, tactics, monthly budget, start month and a
  numeric KPI target
- launch phases and funnel targets
- risks, and a checklist of actions

It contains no totals or rates.

**App code computes:**
- the total monthly budget, and each channel type's share
- funnel conversion, step by step and from awareness to paying
- the gap to Stage 12's marketing costs, with a warning when the plan costs
  more than the projection allows

Channel links are kept only when the search saw them.

**Deck** (`app/deck.py`, `GET /api/ventures/{id}/deck.pptx?language=en|ko`):
- **Built without AI.** It's built from every stage's saved `ai_analysis`
  and answers, plus the Stage 9 product image (converted from WebP to PNG).
- **Library:** python-pptx (MIT), which pulls in Pillow and XlsxWriter.
- **13 slides:** title, problem, MVP, customers, market size, competition,
  business model, assessment and validation, financials, two marketing
  slides, launch and funnel, and next steps.
- **Charts:** native PowerPoint charts, in the validated palette slots, with
  light gridlines and `#,##0` axes. Market sizes are charted only within one
  currency.
- **Missing stages:** a stage with no data gets a "Not completed yet" note,
  and the last slide lists the stages still to complete.
- **Korean decks** set Malgun Gothic as the East Asian font.
- **Positions and sizes are whole EMUs.** PowerPoint refuses a file with
  fractional offsets, and a test guards this.
- **Access and delivery:** served in the caller's RLS scope (404 for another
  organization), with an audit entry `venture.deck_export`. It is sent as an
  attachment with a sanitized ASCII filename and `Cache-Control: private,
  no-store`.

## Professor Notes and Study Guide

Every stage's right-hand column has two icons (`components/learning-tools.tsx`):

- **Professor Notes** (`ProfessorNotes`): the stage's core principles and
  concepts for a teacher — objectives, concepts and why they matter,
  frameworks, a timed one-class teaching plan, discussion questions, common
  misconceptions, a classroom activity, assessment ideas, and an example using
  this venture.
- **Study Guide** (`StudyGuide`): for a student — objectives, key terms,
  concepts explained with examples, a worked example on this venture, a
  self-check quiz (app code drops any question whose answer isn't one of its
  options), a practice exercise and a summary.

`POST /api/ventures/{id}/stages/{slug}/learning/{professor_notes|study_guide}
{language}` writes it (schema-validated, token-metered, stage and venture
passed as untrusted data, no invented sources); it's kept in `ai_runs` per
stage and language, and `GET .../learning/{kind}?language=` returns the latest
(404 `not_generated` until written). Opening an icon shows the saved material
or writes it the first time; **Write again** makes a fresh one.

## AI content in the founder's language

The interface follows the language setting (next-intl; see Settings). AI
content is saved in the language it was generated in (`language` on each
analysis; generic stage feedback is English). When that differs from the
setting, the wizard shows a **translation**:

- `POST /api/ventures/{id}/stages/{slug}/translate {language}`
  (`app/wizard/translation.py`).
- **What gets translated:** app code extracts only human-readable strings.
  It skips IDs, links, sources, codes and enum values (any `snake_case`
  token), computed figures (scores, metrics, health, rates, budget, market
  sizes), the founder's location and brand names.
- **The AI call:** `AIProvider.translate_texts`, in batches of 120. The
  texts are untrusted data, and proper nouns, numbers and URLs stay as they
  are.
- **Merging back:** only keys that were sent are accepted, so a translation
  can never change an ID, a link or a figure. Ticked actions and recorded
  results keep matching.
- **Cache:** the translation is stored in the analysis under
  `translations[language]`, keyed to that analysis's `researched_at`.
  Refreshing a stage makes a new analysis, so the cache follows it. The
  original is never changed.
- **In the wizard:** a notice says the content was translated, with **Show
  original**. If translation fails, the original is shown with a retry.
  Research run from the wizard is already generated in the current language.
- **In the deck:** it uses a cached translation in the deck's language when
  one exists.

## Stage AI agents

A stage **agent** works in a loop instead of making one AI call: the model
calls tools, the server runs them, and the model continues until it returns
the stage's structured output. Code is in `backend/app/agents/`. Stages 1–14
each have one; Stage 15 (Decision & Roadmap) isn't built as a stage yet.

| # | Agent | Returns | Web search |
|---|---|---|---|
| 1 | Idea Scout | `IdeaResearch` | yes |
| 2 | Problem Analyst | `StageAnalysis` (feedback) | yes |
| 3 | Segment Strategist | `StageAnalysis` (feedback) | yes |
| 4 | Competitor Researcher | `AlternativesResearch` | yes |
| 5 | Value Proposition Writer | `StageAnalysis` (feedback) | yes |
| 6 | Market Sizing Analyst | `MarketResearch` (needs the location) | yes |
| 7 | Persona Insights Analyst | `PersonaInsights` (chats + market research) | no |
| 8 | Positioning Strategist | `CompetitivePosition` | yes |
| 9 | DFV Assessor | `DfvAssessment` | no |
| 10 | Product Designer | `MvpConcept` (+ concept image) | no |
| 11 | Business Modeler | `BusinessModel` | yes |
| 12 | Experiment Designer | `ValidationPlan` | no |
| 13 | CFO Agent | `FinancialDraft` | no |
| 14 | Growth Marketer | `MarketingPlan` | yes |

- **One definition per research stage** (`app/wizard/research_defs.py`):
  context (with preconditions such as `location_required`), starting answers
  and the payload step. The single-call research endpoint and the agents both
  use it, so an agent's result goes through exactly the same deterministic
  code (link checks, market sizes, scores, unit economics, projections,
  marketing totals, verbatim-quote checks).
- **Specs** (`app/agents/stages/__init__.py`, `AGENT_SPECS`): built from that
  registry — the stage's existing instructions plus `AGENT_GUIDANCE`, the same
  context as the first message, `read_stage` limited to earlier stages, and a
  drafts model generated from the stage's free-text answer fields. Stages 2,
  3 and 5 return feedback, saved with `analyzed_at` as "Get AI feedback" does.
  Limits: 12 model turns, 6 web searches, 2 questions to the founder,
  `AGENT_MAX_TOKENS` (default 150k) and 5 minutes per stretch of work.
- **Core tools** (`app/agents/tools.py`):
  - `read_stage(slug)`: one earlier stage's answers and AI summary, limited to
    the spec's allowlist.
  - `propose_answers(...)`: draft answers, stored on the run. They are never
    written to the stage; the founder chooses **Use these answers**, which
    fills the form, and saves it normally (so revisions are kept).
  - `ask_founder(question)`: pauses the run (`waiting_for_founder`) until
    the founder answers.
- **Loop** (`app/agents/runner.py`, `AIProvider.agent_turn`): Responses API
  function calling, chained with `previous_response_id`. Tool results go back
  wrapped as `{"untrusted_data": ...}`. An unknown tool, bad arguments or a
  refused call goes back to the model as an error, and the run continues.
  At the turn limit the model must finish (`tool_choice="none"`). Over the
  token or time budget the run fails and nothing is saved. After every turn
  the run saves its position (next input, previous response) and adds the
  time spent to `active_ms`.
- **Pause / resume / stop / re-run:** `paused` is an active status; the loop
  stops at the start of its next turn and resume continues from the saved
  position. Stop is cancel. Re-run starts a new run with `replace: true`,
  cancelling the active one.
- **Saving:** a finished run is stored like single-call research
  (`app/wizard/research_store.py`): an `ai_runs` row (same operation, with
  `agent_run_id`), the stage's `ai_analysis`, and an audit entry. The stage
  answers are untouched (stages 12 and 13 merge their drafted inputs, as
  their research does).
- **Records:** `agent_runs` (status, counters, `active_ms`, the pending
  question, drafts) and `agent_run_steps` (each turn, tool call, search,
  question and answer). At most one active run per venture and stage.
- **Execution:** an asyncio task inside the API process
  (`app/agents/jobs.py`). A restart kills running tasks: a run without a
  heartbeat for 6 minutes is marked `failed` / `interrupted` the next time
  that venture's runs are read or started. Moving to Celery later means
  replacing `launch_in_background` only.
- **Endpoints** (all under `/api/ventures/{id}`):
  - `POST /stages/{slug}/agent-runs {language, replace?}` (202; 404 without
    an agent, 409 if locked or already running, 422 if the stage isn't ready)
  - `GET /stages/{slug}/agent-runs/latest`
  - `POST /agent-runs/{run_id}/answer`, `/cancel`, `/pause`, `/resume`
  - `GET /agents`: all 15 stages with `available`, `locked_by`, the latest
    run, and totals (runs, `active_ms`, tokens) summed in SQL.
- **"Ask AI Mentor Feedback"** (stages 2, 3 and 5;
  `POST .../stages/{slug}/analyze {answers}`) weighs the stage's latest
  finished agent run's draft answers against the answers on the page (sent as
  they are, saved or not; only the stage's own questions). It requires both:
  422 `agent_not_run` without a finished run, 422 `no_answers` when every
  question is empty; the page says which is missing before asking. Drafts and
  answers reach the model as data (`MENTOR_FEEDBACK_NOTE`), and the saved
  feedback records the `agent_run_id` it used.
- **UI:** each stage's **AI agent** panel in the wizard, and **My AI Agents**
  (`/agents`): a venture picker and a table of all 15 agents — status, total
  run time, times ran, tokens, and stop / pause-resume / re-run.
- **Adding Stage 15's agent:** build the stage, add its research definition,
  instructions and agent name, then `AGENT_STAGES` in
  `frontend/src/lib/api.ts`, a fake `agent_turn` output and tests.

## Token usage and limits

Every AI call records the tokens it used, and an organization can cap them.

- **Counting** (`app/ai/usage.py`): providers call `add_tokens()` after every
  model, image and embedding call (`usage.total_tokens`); it adds to the meter
  opened around that work (a context variable, so concurrent requests never
  mix). The fake provider counts 10 tokens per call for tests.
- **Ledger** (`token_usage`, RLS): one row per AI action —
  `async with metered(...)` in `app/tokens.py` wraps research, feedback,
  translation, persona chat and market profile, idea interpretation,
  reports and document embedding/retrieval; the agent runner adds a row per
  model turn (`agent_turn`). A call that fails after using tokens is still
  recorded (in its own session). `venture_id` becomes NULL when a venture is
  permanently deleted, so the organization's total keeps it. Agent usage from
  before the ledger was backfilled from `agent_runs`.
- **Limits** (`organization_token_limits`, RLS): per venture idea and for the
  whole organization ("the Platform"); NULL = no limit. Set by an
  organization owner/admin (`PUT /api/token-usage/limits`, audited
  `token_limits.update`); everyone sees usage (`GET /api/token-usage`).
- **Enforcement** (server-side): every AI action checks the caps first and
  returns **429** `venture_token_limit` or `organization_token_limit`;
  starting, re-running, resuming and answering an agent check too, and a
  running agent stops before its next turn (`failed` /
  `token_limit_reached`). A call already in flight is never cut off.
- **UI:** Settings → **Token Usage Setting** (collapsible) → `/settings/tokens`:
  the organization total and each venture idea's usage against the limits,
  and the two limit fields (read-only for members). The 429 reasons show
  "You have reached the maximum number of tokens allowed for your business
  idea session. Please request the Administrator for additional tokens." (or
  the organization version) wherever an AI action is refused
  (`frontend/src/lib/token-limit.ts`, `authErrorMessage`).

## Archiving ventures

The trash can on **My ventures** archives a venture after "Are you sure?" and
re-authentication (password, or an emailed code for accounts without one;
see the security model).

- **In place:** `ventures.archived_at` / `archived_by` are set; every row the
  venture owns (all 15 stages' answers and revisions, AI content, research
  and agent runs, persona chats, documents and files) stays as it is. Active
  agent runs are cancelled. `_load_venture` hides archived ventures from every
  endpoint except the archive ones.
- **Archived ventures** (`GET /api/ventures/archived`, collapsed section on My
  ventures): the user's own, or all of the organization's for an owner/admin.
  - **Restore** (`POST .../restore`) clears `archived_at`; everything is back.
  - **Download archive** (`GET .../archive/export`, `app/venture_archive.py`):
    the whole venture as one JSON file (`weeaim.venture_archive.v1`) — the
    idea and its versions, all 15 stages in order with answers, AI content
    and revision history, research runs, persona chats, agent runs and
    document metadata.
  - **Delete permanently** (`POST .../delete-permanently`, re-authenticated)
    erases it with `app/venture_deletion.py`.

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
