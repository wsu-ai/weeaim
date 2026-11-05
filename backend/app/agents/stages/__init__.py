"""The stage agents, by stage slug.

Research stages (1, 4, 6-14) return the same structured output as their
single-call research and are finished by the same payload code
(app/wizard/research_defs.py), so every computed figure stays deterministic.
Stages 2, 3 and 5 have no research: their agents return the stage's feedback
(StageAnalysis), saved the way "Get AI feedback" saves it.

Stage 15 (decision_roadmap) has no agent: the stage itself isn't built yet.
"""

import json

from pydantic import BaseModel, Field, create_model

from app.agents.spec import AGENT_GUIDANCE, AgentSpec
from app.agents.tools import ask_founder, propose_answers_tool, read_stage
from app.ai import openai_provider as prompts
from app.ai.schemas import StageAnalysis
from app.wizard.research_defs import RESEARCH_DEFS, FinalizeArgs, Prepared
from app.wizard.stages import STAGE_ANSWER_SCHEMAS

# Stage order, for the read_stage allowlists ("every earlier stage").
STAGE_ORDER = (
    "idea_discovery",
    "problem_definition",
    "customer_definition",
    "existing_alternatives",
    "value_proposition",
    "market_evidence",
    "persona_validation",
    "competitive_position",
    "dfv_assessment",
    "mvp",
    "business_model",
    "validation_plan",
    "financial_analysis",
    "marketing_plan",
    "decision_roadmap",
)

AGENT_NAMES = {
    "idea_discovery": "Idea Scout",
    "problem_definition": "Problem Analyst",
    "customer_definition": "Segment Strategist",
    "existing_alternatives": "Competitor Researcher",
    "value_proposition": "Value Proposition Writer",
    "market_evidence": "Market Sizing Analyst",
    "persona_validation": "Persona Insights Analyst",
    "competitive_position": "Positioning Strategist",
    "dfv_assessment": "DFV Assessor",
    "mvp": "Product Designer",
    "business_model": "Business Modeler",
    "validation_plan": "Experiment Designer",
    "financial_analysis": "CFO Agent",
    "marketing_plan": "Growth Marketer",
    "decision_roadmap": "Decision Agent",
}

# Answer fields an agent never drafts: the founder's own location and
# choices, ticked progress, recorded results and computed values.
NOT_DRAFTED = {
    "user_country",
    "user_metro_city",
    "offering_type",
    "completed_actions",
    "experiment_results",
    "experiment_outcomes",
    "decision_signal",
    "financial_inputs",
    "inputs_source",
    "projection",
    "personas",
}

INSTRUCTIONS = {
    "idea_discovery": prompts.RESEARCH_IDEA_INSTRUCTIONS,
    "existing_alternatives": prompts.RESEARCH_ALTERNATIVES_INSTRUCTIONS,
    "market_evidence": prompts.RESEARCH_MARKET_INSTRUCTIONS,
    "persona_validation": prompts.SUMMARIZE_PERSONAS_INSTRUCTIONS,
    "competitive_position": prompts.RESEARCH_POSITION_INSTRUCTIONS,
    "dfv_assessment": prompts.ASSESS_DFV_INSTRUCTIONS,
    "mvp": prompts.RESEARCH_MVP_INSTRUCTIONS,
    "business_model": prompts.RESEARCH_BUSINESS_MODEL_INSTRUCTIONS,
    "validation_plan": prompts.PLAN_VALIDATION_INSTRUCTIONS,
    "financial_analysis": prompts.DRAFT_FINANCIALS_INSTRUCTIONS,
    "marketing_plan": prompts.RESEARCH_MARKETING_INSTRUCTIONS,
}

# What each feedback stage's agent researches before drafting answers.
FEEDBACK_FOCUS = {
    "problem_definition": (
        "Research how real the problem is: evidence that the target customers "
        "have it, how often, and how badly"
    ),
    "customer_definition": (
        "Research who feels the problem most: the most promising customer "
        "segment, its characteristics, and what triggers a purchase"
    ),
    "value_proposition": (
        "Research what these customers value and what competitors promise, then "
        "shape a clear value proposition, its key benefits and its differentiation"
    ),
}


def steps(has_web: bool, drafts: list[str]) -> str:
    search = " search the web where it helps;" if has_web else ""
    return (
        " Work in this order: read the earlier stages you need with read_stage (if you have it);"
        f"{search} then call propose_answers with draft answers to this stage's "
        f"questions ({', '.join(drafts)}); then return the final result."
    )


def drafts_model(slug: str) -> type[BaseModel]:
    """The stage's free-text (and text-list) answers, for propose_answers."""
    fields = {}
    for name, info in STAGE_ANSWER_SCHEMAS[slug].model_fields.items():
        if name in NOT_DRAFTED:
            continue
        if info.annotation is str:
            fields[name] = (str, Field(max_length=2000))
        elif info.annotation == list[str]:
            fields[name] = (list[str], Field(max_length=8))
    return create_model(f"{slug.title().replace('_', '')}Drafts", **fields)


def earlier(slug: str) -> tuple[str, ...]:
    return STAGE_ORDER[: STAGE_ORDER.index(slug)]


def tools_for(slug: str, drafts: type[BaseModel]) -> tuple:
    # Stage 1 has no earlier stage to read.
    reading = (read_stage,) if earlier(slug) else ()
    return (*reading, propose_answers_tool(drafts), ask_founder)


def research_spec(slug: str) -> AgentSpec:
    definition = RESEARCH_DEFS[slug]
    model = drafts_model(slug)
    wrapper = definition.result_wrapper

    def wrap(parsed, sources, consulted):
        return wrapper(research=parsed, sources=sources, consulted_urls=consulted) if wrapper else parsed

    return AgentSpec(
        slug=slug,
        name=AGENT_NAMES[slug],
        operation=definition.operation,
        instructions=INSTRUCTIONS[slug] + AGENT_GUIDANCE + steps(definition.web_search, list(model.model_fields)),
        tools=tools_for(slug, model),
        web_search=definition.web_search,
        output_schema=definition.output_schema,
        answers_model=model,
        readable_stages=earlier(slug),
        prepare=definition.prepare,
        wrap=wrap,
        finalize=definition.payload,
    )


def feedback_spec(slug: str) -> AgentSpec:
    model = drafts_model(slug)

    async def prepare(session, venture, responses) -> Prepared:
        lines = [f"Title: {venture.title}", f"Idea: {venture.current_idea_statement or venture.original_idea}"]
        for label, value in (("Industry", venture.industry), ("Geography", venture.geography)):
            if value:
                lines.append(f"{label}: {value}")
        response = responses.get(slug)
        answers = {k: v for k, v in ((response.answers or {}) if response else {}).items() if v}
        lines.append(f"Wizard stage: {slug}")
        lines.append(f"The founder's current answers for this stage: {json.dumps(answers, ensure_ascii=False)}")
        return Prepared("\n".join(lines), {})

    async def finalize(a: FinalizeArgs) -> dict:
        # Saved like "Get AI feedback" (analyzed_at), in the run's language.
        return {**a.result.model_dump(), "analyzed_at": a.now.isoformat(), "language": a.language}

    return AgentSpec(
        slug=slug,
        name=AGENT_NAMES[slug],
        operation="stage_feedback",
        instructions=(
            prompts.ANALYZE_STAGE_INSTRUCTIONS
            + f" {FEEDBACK_FOCUS[slug]}. Your feedback reviews the founder's current "
            "answers (or their absence) in the light of what you found."
            + AGENT_GUIDANCE
            + steps(True, list(model.model_fields))
        ),
        tools=tools_for(slug, model),
        web_search=True,
        output_schema=StageAnalysis,
        answers_model=model,
        readable_stages=earlier(slug),
        prepare=prepare,
        wrap=lambda parsed, sources, consulted: parsed,
        finalize=finalize,
    )


AGENT_SPECS: dict[str, AgentSpec] = {
    slug: (research_spec(slug) if slug in RESEARCH_DEFS else feedback_spec(slug))
    for slug in STAGE_ORDER
    if slug in RESEARCH_DEFS or slug in FEEDBACK_FOCUS
}
