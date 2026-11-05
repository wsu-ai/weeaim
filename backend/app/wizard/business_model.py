"""Stage 10 (Business Model): context, unit economics and the stored result.

The recommended model is synthesized from stages 1-9 (never locked: missing
stages count as missing evidence). The AI proposes sourced unit-economics
INPUTS; everything derived from them is computed HERE, never by the model
(CLAUDE.md: deterministic application code for financial calculations):

    contribution   = monthly revenue per customer - monthly cost to serve
    margin         = contribution / revenue
    lifetime       = 1 / monthly churn                  (months)
    LTV            = max(contribution, 0) x lifetime
    LTV:CAC        = LTV / customer acquisition cost
    CAC payback    = CAC / contribution                 (months; never if <= 0)

Health checks use fixed thresholds (see HEALTH_THRESHOLDS).
"""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from app.ai.schemas import BusinessModelResult, UnitEconomicsInputs
from app.models import Venture, WizardResponse
from app.wizard.actions import with_action_ids
from app.wizard.competitive_position import _analysis, _pick, founder_and_research_context
from app.wizard.dfv_assessment import research_data_with_assessment
from app.wizard.mvp import STAGE_LABELS as STAGE_1_TO_8_LABELS
from app.wizard.idea_research import _host, known_hosts
from app.wizard.market_research import _figure

STAGE_LABELS = {
    **STAGE_1_TO_8_LABELS,
    "mvp": "Stage 10 - Minimum viable product",
}
INPUT_NAMES = (
    "monthly_revenue_per_customer",
    "monthly_cost_to_serve",
    "customer_acquisition_cost",
    "monthly_churn_rate",
)
# healthy at or above the first value, watch at or above the second (for
# payback: at or below), unhealthy otherwise.
HEALTH_THRESHOLDS = {
    "ltv_to_cac": (Decimal("3"), Decimal("1")),
    "payback_months": (Decimal("12"), Decimal("24")),
    "contribution_margin": (Decimal("0.5"), Decimal("0.2")),
}


def _decimal(value: float) -> Decimal:
    # Via str() so 0.1 stays 0.1 rather than its binary approximation.
    return Decimal(str(value))


def _round(value: Decimal, places: str) -> float:
    return float(value.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def unit_economics(inputs: UnitEconomicsInputs) -> dict:
    """Derived per-customer figures. None means undefined (e.g. payback when
    each customer loses money, or LTV:CAC with no acquisition cost)."""
    revenue = _decimal(inputs.monthly_revenue_per_customer.value)
    cost = _decimal(inputs.monthly_cost_to_serve.value)
    cac = _decimal(inputs.customer_acquisition_cost.value)
    churn = _decimal(inputs.monthly_churn_rate.value)

    contribution = revenue - cost
    lifetime = Decimal(1) / churn
    ltv = max(contribution, Decimal(0)) * lifetime
    return {
        "currency": inputs.currency.strip().upper(),
        "monthly_contribution": _round(contribution, "0.01"),
        "contribution_margin": _round(contribution / revenue, "0.0001") if revenue > 0 else None,
        "customer_lifetime_months": _round(lifetime, "0.1"),
        "lifetime_value": _round(ltv, "0.01"),
        "ltv_to_cac": _round(ltv / cac, "0.01") if cac > 0 else None,
        "cac_payback_months": _round(cac / contribution, "0.1") if contribution > 0 else None,
    }


def health_checks(economics: dict) -> dict[str, str]:
    """healthy / watch / unhealthy for LTV:CAC, payback and margin."""
    ratio_ok, ratio_watch = HEALTH_THRESHOLDS["ltv_to_cac"]
    payback_ok, payback_watch = HEALTH_THRESHOLDS["payback_months"]
    margin_ok, margin_watch = HEALTH_THRESHOLDS["contribution_margin"]

    ratio = economics["ltv_to_cac"]
    if ratio is None:  # no acquisition cost: healthy if customers are profitable
        ratio_status = "healthy" if economics["lifetime_value"] > 0 else "unhealthy"
    else:
        ratio_status = _band(_decimal(ratio), ratio_ok, ratio_watch)

    payback = economics["cac_payback_months"]
    if payback is None:  # never paid back
        payback_status = "unhealthy"
    else:
        payback = _decimal(payback)
        payback_status = "healthy" if payback <= payback_ok else "watch" if payback <= payback_watch else "unhealthy"

    margin = economics["contribution_margin"]
    margin_status = "unhealthy" if margin is None else _band(_decimal(margin), margin_ok, margin_watch)
    return {"ltv_to_cac": ratio_status, "cac_payback_months": payback_status, "contribution_margin": margin_status}


def _band(value: Decimal, healthy_at: Decimal, watch_at: Decimal) -> str:
    if value >= healthy_at:
        return "healthy"
    return "watch" if value >= watch_at else "unhealthy"


def _research_data(responses: dict[str, WizardResponse]) -> dict:
    """Stage 8's research data and assessment, plus the Stage 9 MVP concept."""
    data = research_data_with_assessment(responses)
    mvp = _analysis(responses, "mvp")
    data["stage_9_mvp"] = _pick(
        mvp, ("offering_type", "name", "tagline", "summary", "target_user", "core_features", "left_out_for_now")
    )
    return data


def bm_context(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """The founder's stage 1-9 answers, then the earlier research as untrusted data."""
    return founder_and_research_context(venture, responses, STAGE_LABELS, _research_data(responses))


def based_on(responses: dict[str, WizardResponse]) -> str | None:
    """When the stage 1-9 answers or research this model used last changed."""
    times = [r.updated_at for slug, r in responses.items() if slug in STAGE_LABELS and r.updated_at]
    return max(times).isoformat() if times else None


def bm_payload(
    result: BusinessModelResult,
    language: str,
    researched_at: datetime,
    based_on_at: str | None,
) -> dict:
    model = result.research
    sources = [s for s in result.sources if _host(s.url)]
    hosts = known_hosts(sources, result.consulted_urls)
    inputs = model.unit_economics_inputs
    economics = unit_economics(inputs)
    return {
        "kind": "business_model",
        **model.model_dump(exclude={"unit_economics_inputs", "things_to_complete"}),
        "unit_economics": {
            "currency": economics["currency"],
            # Each input's source is checked like Stage 6's figures.
            "inputs": {name: _figure(getattr(inputs, name), hosts) for name in INPUT_NAMES},
            "metrics": economics,
            "health": health_checks(economics),
        },
        "things_to_complete": with_action_ids(model.things_to_complete),
        "sources": [s.model_dump() for s in sources],
        "researched_at": researched_at.isoformat(),
        "based_on": based_on_at,
        "language": language,
    }
