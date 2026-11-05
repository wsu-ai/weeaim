"""Each research stage's AI research, defined once.

Used by the single-call research endpoint (app/routers/wizard.py) and by the
stage agents (app/agents/stages/), so both build the same context and turn the
model's output into the stage's ai_analysis with the same deterministic code
(link checks, market sizes, scores, unit economics, projections...).
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import (
    AlternativesResearch,
    AlternativesResearchResult,
    BusinessModel,
    BusinessModelResult,
    CompetitivePosition,
    CompetitivePositionResult,
    DfvAssessment,
    FinancialDraft,
    IdeaResearch,
    IdeaResearchResult,
    MarketingPlan,
    MarketingPlanResult,
    MarketResearch,
    MarketResearchResult,
    MvpConcept,
    PersonaInsights,
    ValidationPlan,
)
from app.auth import AuthContext
from app.models import PersonaMessage, Venture, WizardResponse
from app.wizard import (
    alternatives_research,
    business_model,
    competitive_position,
    dfv_assessment,
    financial_analysis,
    market_research,
    marketing_plan,
    mvp,
    personas,
    validation_plan,
)
from app.external_sources import query_sources, results_block
from app.wizard.idea_research import research_payload

Responses = dict[str, WizardResponse]


class ResearchPrecondition(Exception):
    """The stage can't be researched yet (sent to the client as a 422 detail)."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass
class Prepared:
    context: str
    initial_answers: dict
    # Whatever the payload step needs again (location, transcripts...).
    extras: dict = field(default_factory=dict)


@dataclass
class FinalizeArgs:
    session: AsyncSession
    provider: AIProvider
    auth: AuthContext
    venture: Venture
    responses: Responses
    prepared: Prepared
    result: object
    language: str
    now: datetime


@dataclass(frozen=True)
class ResearchDef:
    slug: str
    # The ai_runs operation research results are filed under.
    operation: str
    # The AIProvider method for single-call research.
    call: str
    # The model's structured output, and the wrapper that adds web sources (None: no web search).
    output_schema: type[BaseModel]
    result_wrapper: type[BaseModel] | None
    prepare: Callable[[AsyncSession, Venture, Responses], Awaitable[Prepared]]
    payload: Callable[[FinalizeArgs], Awaitable[dict]]
    # Work the research button does first, e.g. Stage 7 researches the market
    # for personas that have none yet: (session, provider, auth, venture, responses, language).
    before: Callable[..., Awaitable[None]] | None = None

    @property
    def web_search(self) -> bool:
        return self.result_wrapper is not None


# --- Context ---------------------------------------------------------------------------------------


async def _idea(session, venture, responses) -> Prepared:
    response = responses.get("idea_discovery")
    saved_idea = ((response.answers or {}).get("idea_statement") or "").strip() if response else ""
    idea = saved_idea or venture.current_idea_statement or venture.original_idea
    lines = [f"Idea: {idea}"]
    for label, value in (("Title", venture.title), ("Industry", venture.industry), ("Geography", venture.geography)):
        if value:
            lines.append(f"{label}: {value}")
    # The organization's external data sources, searched with the idea.
    external = await query_sources(session, venture.organization_id, venture.title or idea)
    block = results_block(external)
    if block:
        lines.append(block)
    return Prepared(
        "\n".join(lines),
        {"idea_statement": idea, "differentiation_plan": ""},
        {"external": external},
    )


async def _alternatives(session, venture, responses) -> Prepared:
    return Prepared(
        alternatives_research.venture_context(venture, responses),
        {"current_solutions": "", "why_switch": "", "biggest_threat": ""},
    )


async def _market(session, venture, responses) -> Prepared:
    try:
        location = market_research.founder_location(responses)
    except market_research.LocationMissing:
        raise ResearchPrecondition("location_required")
    return Prepared(
        market_research.market_context(venture, responses),
        {
            "user_country": location[0],
            "user_metro_city": location[1],
            "beachhead_segment": "",
            "pricing_assumption": "",
            "market_takeaways": "",
        },
        {"location": location},
    )


async def _personas(session, venture, responses) -> Prepared:
    defined = personas.saved_personas(responses)
    rows = (
        await session.execute(
            select(PersonaMessage)
            .where(PersonaMessage.venture_id == venture.id)
            .order_by(PersonaMessage.created_at, PersonaMessage.id)
        )
    ).scalars().all()
    transcripts: dict[str, list[dict]] = {}
    for row in rows:
        transcripts.setdefault(row.persona_id, []).append({"role": row.role, "content": row.content})
    markets = {}
    for persona in defined:
        profile = await personas.cached_market_profile(
            session, venture.id, persona["id"], personas.criteria_key(persona, responses)
        )
        if profile is not None:
            markets[persona["id"]] = profile
    # Something to summarize: a conversation, or a persona's market research.
    if not any(transcripts.get(p["id"]) or p["id"] in markets for p in defined):
        raise ResearchPrecondition("no_conversations")
    return Prepared(
        personas.insights_context(venture, responses, transcripts, markets),
        {"validation_takeaways": "", "next_real_test": "", "personas": defined},
        {"transcripts": transcripts, "defined": defined, "markets": markets},
    )


def _simple(context_fn, initial: dict | Callable[[], dict]):
    async def prepare(session, venture, responses) -> Prepared:
        answers = initial() if callable(initial) else dict(initial)
        return Prepared(context_fn(venture, responses), answers)

    return prepare


# --- Payload ---------------------------------------------------------------------------------------


async def _idea_payload(a: FinalizeArgs) -> dict:
    return research_payload(a.result, a.language, a.now, a.prepared.extras.get("external"))


async def _alternatives_payload(a: FinalizeArgs) -> dict:
    return alternatives_research.alternatives_payload(
        a.result, a.language, a.now, alternatives_research.based_on(a.responses)
    )


async def _market_payload(a: FinalizeArgs) -> dict:
    return market_research.market_payload(
        a.result, a.language, a.now, market_research.based_on(a.responses), a.prepared.extras["location"]
    )


async def _personas_payload(a: FinalizeArgs) -> dict:
    return personas.insights_payload(
        a.result,
        a.prepared.extras["transcripts"],
        a.prepared.extras["defined"],
        a.language,
        a.now,
        a.prepared.extras.get("markets"),
    )


async def _position_payload(a: FinalizeArgs) -> dict:
    return competitive_position.position_payload(
        a.result, a.language, a.now, competitive_position.based_on(a.responses)
    )


async def _dfv_payload(a: FinalizeArgs) -> dict:
    return dfv_assessment.dfv_payload(a.result, a.language, a.now, dfv_assessment.based_on(a.responses))


async def _mvp_payload(a: FinalizeArgs) -> dict:
    # A physical product also gets a concept image (its own ai_runs row).
    image = (
        await mvp.generate_image(a.session, a.provider, a.auth, a.venture, a.result)
        if a.result.offering_type == "physical_product"
        else None
    )
    return mvp.mvp_payload(
        a.result,
        a.language,
        a.now,
        mvp.based_on(a.responses),
        mvp.founder_offering_type(a.responses),
        image,
    )


async def _bm_payload(a: FinalizeArgs) -> dict:
    return business_model.bm_payload(a.result, a.language, a.now, business_model.based_on(a.responses))


async def _vp_payload(a: FinalizeArgs) -> dict:
    return validation_plan.vp_payload(a.result, a.language, a.now, validation_plan.based_on(a.responses))


async def _fa_payload(a: FinalizeArgs) -> dict:
    return financial_analysis.fa_payload(a.result, a.language, a.now, financial_analysis.based_on(a.responses))


async def _mp_payload(a: FinalizeArgs) -> dict:
    return marketing_plan.mp_payload(
        a.result, a.language, a.now, marketing_plan.based_on(a.responses), a.responses
    )


_CHECKLIST = {"completed_actions": []}

RESEARCH_DEFS: dict[str, ResearchDef] = {
    d.slug: d
    for d in (
        ResearchDef("idea_discovery", "idea_research", "research_idea", IdeaResearch, IdeaResearchResult,
                    _idea, _idea_payload),
        ResearchDef("existing_alternatives", "alternatives_research", "research_alternatives",
                    AlternativesResearch, AlternativesResearchResult, _alternatives, _alternatives_payload),
        ResearchDef("market_evidence", "market_research", "research_market", MarketResearch,
                    MarketResearchResult, _market, _market_payload),
        ResearchDef("persona_validation", "persona_insights", "summarize_persona_insights", PersonaInsights,
                    None, _personas, _personas_payload, before=personas.research_missing_market_profiles),
        ResearchDef(
            "competitive_position", "competitive_position", "research_competitive_position",
            CompetitivePosition, CompetitivePositionResult,
            _simple(competitive_position.position_context,
                    {"chosen_positioning": "", "main_competitor_focus": "", "first_actions": "", **_CHECKLIST}),
            _position_payload,
        ),
        ResearchDef(
            "dfv_assessment", "dfv_assessment", "assess_dfv", DfvAssessment, None,
            _simple(dfv_assessment.dfv_context,
                    {"biggest_risk": "", "evidence_plan": "", "assessment_reflection": "", **_CHECKLIST}),
            _dfv_payload,
        ),
        ResearchDef(
            "mvp", "mvp", "research_mvp", MvpConcept, None,
            _simple(mvp.mvp_context, {"mvp_scope_changes": "", "build_plan": "", "test_plan": "", "offering_type": ""}),
            _mvp_payload,
        ),
        ResearchDef(
            "business_model", "business_model", "research_business_model", BusinessModel, BusinessModelResult,
            _simple(business_model.bm_context,
                    {"model_adjustments": "", "launch_price": "", "first_customers_plan": "", **_CHECKLIST}),
            _bm_payload,
        ),
        ResearchDef(
            "validation_plan", "validation_plan", "plan_validation", ValidationPlan, None,
            _simple(validation_plan.vp_context, lambda: validation_plan.finalize_answers({}, None)),
            _vp_payload,
        ),
        ResearchDef(
            "financial_analysis", "financial_analysis", "draft_financials", FinancialDraft, None,
            _simple(financial_analysis.fa_context, lambda: financial_analysis.finalize_answers({}, None)),
            _fa_payload,
        ),
        ResearchDef(
            "marketing_plan", "marketing_plan", "research_marketing_plan", MarketingPlan, MarketingPlanResult,
            _simple(marketing_plan.mp_context,
                    {"first_channel": "", "marketing_budget": "", "success_90_days": "", **_CHECKLIST}),
            _mp_payload,
        ),
    )
}
