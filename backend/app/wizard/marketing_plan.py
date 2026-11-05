"""Stage 13 (Marketing Plan): context, budget and funnel maths, stored result.

The AI writes a differentiated marketing plan from stages 1-12 (with a light
web search for channels and platforms in the target market). Figures derived
from it are computed HERE, never by the model (CLAUDE.md):

    total monthly budget  = sum of channel budgets
    share of each type    = type budget / total
    funnel conversion     = each step / the step before, and paying / awareness
    vs. the projection    = total budget - Stage 12's monthly marketing costs
"""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from app.ai.schemas import MarketingPlanResult
from app.models import Venture, WizardResponse
from app.wizard.actions import with_action_ids
from app.wizard.competitive_position import _analysis, _pick, founder_and_research_context
from app.wizard.financial_analysis import STAGE_LABELS as STAGE_1_TO_11_LABELS
from app.wizard.financial_analysis import _inputs
from app.wizard.idea_research import _host, known_hosts, verified_url
from app.wizard.validation_plan import _research_data as stages_8_to_10_data

STAGE_LABELS = {
    **STAGE_1_TO_11_LABELS,
    "financial_analysis": "Stage 13 - Financial analysis",
}
FUNNEL_STEPS = ("awareness", "leads", "trials", "paying")


def _d(value: float) -> Decimal:
    return Decimal(str(value))


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _ratio(numerator: Decimal, denominator: Decimal) -> float | None:
    if denominator <= 0:
        return None
    return float((numerator / denominator).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def projection_marketing_costs(responses: dict[str, WizardResponse]) -> float | None:
    """Stage 12's monthly marketing costs (flat amounts), from the inputs in use."""
    response = responses.get("financial_analysis")
    inputs = _inputs(((response.answers or {}) if response else {}).get("financial_inputs"))
    if inputs is None:
        inputs = _inputs(_analysis(responses, "financial_analysis").get("inputs"))
    if inputs is None:
        return None
    return _money(sum((_d(c.monthly_amount) for c in inputs.operating_costs if c.category == "marketing"), Decimal(0)))


def budget_summary(channels: list[dict], projection_budget: float | None) -> dict:
    """Total monthly budget, each channel type's share, and the gap to Stage 12."""
    total = sum((_d(c["monthly_budget"]) for c in channels), Decimal(0))
    by_type: dict[str, Decimal] = {}
    for channel in channels:
        by_type[channel["type"]] = by_type.get(channel["type"], Decimal(0)) + _d(channel["monthly_budget"])
    gap = None if projection_budget is None else _money(total - _d(projection_budget))
    return {
        "total_monthly": _money(total),
        "by_type": [
            {"type": kind, "monthly": _money(amount), "share": _ratio(amount, total)}
            for kind, amount in sorted(by_type.items(), key=lambda item: -item[1])
        ],
        "projection_monthly": projection_budget,
        "gap_to_projection": gap,
        "over_projection": gap is not None and gap > 0,
    }


def funnel_rates(funnel: dict) -> dict:
    """Step-by-step conversion, and paying customers per awareness."""
    values = {step: _d(funnel[step]) for step in FUNNEL_STEPS}
    return {
        "leads_per_awareness": _ratio(values["leads"], values["awareness"]),
        "trials_per_lead": _ratio(values["trials"], values["leads"]),
        "paying_per_trial": _ratio(values["paying"], values["trials"]),
        "paying_per_awareness": _ratio(values["paying"], values["awareness"]),
    }


def _research_data(responses: dict[str, WizardResponse]) -> dict:
    """Stages 8-10 as Stage 11 used them, plus what marketing builds on."""
    data = stages_8_to_10_data(responses)
    position = _analysis(responses, "competitive_position")
    data["stage_7_competitive_position"].update(
        _pick(position, ("positioning_statement", "target_segment", "market_category"))
    )
    market = _analysis(responses, "market_evidence")
    data["stage_6_market_research"]["location"] = market.get("location")
    model = _analysis(responses, "business_model")
    data["stage_10_business_model"]["pricing"] = model.get("pricing")
    data["stage_12_financial_analysis"] = {"monthly_marketing_costs": projection_marketing_costs(responses)}
    return data


def mp_context(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """The founder's stage 1-12 answers, then the earlier research as untrusted data."""
    return founder_and_research_context(venture, responses, STAGE_LABELS, _research_data(responses))


def based_on(responses: dict[str, WizardResponse]) -> str | None:
    """When the stage 1-12 answers or research this plan used last changed."""
    times = [r.updated_at for slug, r in responses.items() if slug in STAGE_LABELS and r.updated_at]
    return max(times).isoformat() if times else None


def mp_payload(
    result: MarketingPlanResult,
    language: str,
    researched_at: datetime,
    based_on_at: str | None,
    responses: dict[str, WizardResponse],
) -> dict:
    plan = result.research
    sources = [s for s in result.sources if _host(s.url)]
    hosts = known_hosts(sources, result.consulted_urls)
    channels = [{**c.model_dump(), "url": verified_url(c.url, hosts)} for c in plan.channels]
    funnel = plan.funnel.model_dump()
    return {
        "kind": "marketing_plan",
        **plan.model_dump(exclude={"channels", "action_items", "funnel"}),
        "currency": plan.currency.strip().upper(),
        "channels": channels,
        "budget": budget_summary(channels, projection_marketing_costs(responses)),
        "funnel": {**funnel, "rates": funnel_rates(funnel)},
        "action_items": with_action_ids(plan.action_items),
        "sources": [s.model_dump() for s in sources],
        "researched_at": researched_at.isoformat(),
        "based_on": based_on_at,
        "language": language,
    }

