"""Stage 12 (Financial Analysis): context, inputs and the stored result.

The AI drafts the inputs (expenses, revenue drivers, funding) from stages
1-11; the founder edits them. The projection is recomputed by app code
(app/wizard/financials.py) on every save and every Refresh, never by the
model, and never taken from the client.

Refresh keeps the founder's own inputs; inputs the founder never changed
follow the new draft.
"""

from datetime import datetime

from pydantic import ValidationError

from app.ai.schemas import FinancialDraft, FinancialInputs
from app.models import Venture, WizardResponse
from app.wizard.competitive_position import _analysis, _pick, founder_and_research_context
from app.wizard.financials import project
from app.wizard.validation_plan import STAGE_LABELS as STAGE_1_TO_10_LABELS
from app.wizard.validation_plan import _research_data as stages_8_to_10_data

STAGE_LABELS = {
    **STAGE_1_TO_10_LABELS,
    "validation_plan": "Stage 12 - Validation plan",
}


def _research_data(responses: dict[str, WizardResponse]) -> dict:
    """Stages 8-10 as Stage 11 used them, plus the Stage 10 pricing and
    unit-economics inputs and the Stage 11 experiments."""
    data = stages_8_to_10_data(responses)
    model = _analysis(responses, "business_model")
    economics = model.get("unit_economics") if isinstance(model.get("unit_economics"), dict) else {}
    inputs = economics.get("inputs") if isinstance(economics.get("inputs"), dict) else {}
    data["stage_10_business_model"].update(
        {
            "pricing": model.get("pricing"),
            "currency": economics.get("currency"),
            "unit_economics_inputs": {
                name: _pick(figure, ("value", "unit", "is_estimate"))
                for name, figure in inputs.items()
                if isinstance(figure, dict)
            },
        }
    )
    plan = _analysis(responses, "validation_plan")
    data["stage_11_validation_plan"] = {
        "experiments": [
            _pick(e, ("title", "metric", "critical", "phase", "cost_estimate"))
            for e in plan.get("experiments") or []
            if isinstance(e, dict)
        ]
    }
    return data


def fa_context(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """The founder's stage 1-11 answers, then the earlier research as untrusted data."""
    return founder_and_research_context(venture, responses, STAGE_LABELS, _research_data(responses))


def based_on(responses: dict[str, WizardResponse]) -> str | None:
    """When the stage 1-11 answers or research these figures used last changed."""
    times = [r.updated_at for slug, r in responses.items() if slug in STAGE_LABELS and r.updated_at]
    return max(times).isoformat() if times else None


def _inputs(value: object) -> FinancialInputs | None:
    if not isinstance(value, dict):
        return None
    try:
        return FinancialInputs.model_validate(value)
    except ValidationError:
        return None


def finalize_answers(answers: dict, analysis: dict | None, refreshed: bool = False) -> dict:
    """Sets the inputs (draft or founder's) and recomputes the projection.

    The projection and inputs_source are always computed here; whatever a
    client sends for them is replaced.
    """
    finalized = {"funding_plan": "", "biggest_cost_risk": "", "financial_takeaways": "", **answers}
    draft = _inputs((analysis or {}).get("inputs")) if isinstance(analysis, dict) else None
    inputs = _inputs(finalized.get("financial_inputs"))
    if inputs is None or (refreshed and finalized.get("inputs_source") != "founder"):
        inputs = draft
    finalized["financial_inputs"] = inputs.model_dump() if inputs else None
    finalized["inputs_source"] = (
        "ai_draft" if inputs is None or (draft is not None and inputs.model_dump() == draft.model_dump()) else "founder"
    )
    finalized["projection"] = project(inputs) if inputs else None
    return finalized


def fa_payload(draft: FinancialDraft, language: str, researched_at: datetime, based_on_at: str | None) -> dict:
    return {
        "kind": "financial_analysis",
        **draft.model_dump(),
        # No web search in this stage: it drafts inputs from the evidence so far.
        "sources": [],
        "researched_at": researched_at.isoformat(),
        "based_on": based_on_at,
        "language": language,
    }
