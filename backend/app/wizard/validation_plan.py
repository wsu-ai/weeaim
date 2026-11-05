"""Stage 11 (Validation Plan): context, result evaluation and the stored result.

The AI plans experiments for the riskiest assumptions from stages 1-10, each
with a pass/fail bar set before any results exist. The founder records each
experiment's actual result; the outcome is evaluated HERE, deterministically,
never by the model (CLAUDE.md: application code for scoring):

    at_least:  value >= pass                  -> passed
               value <= fail (if a fail bar)  -> failed
               otherwise                      -> inconclusive (or failed
                                                 when there is no fail bar)
    at_most:   the mirror image
    no value:                                 -> not_run

Decision signal: stop_or_pivot if any critical experiment failed; proceed if
every critical experiment passed; otherwise keep_testing (not_started before
any result).
"""

from datetime import datetime

from app.ai.schemas import ValidationPlan
from app.models import Venture, WizardResponse
from app.wizard.actions import with_action_ids
from app.wizard.business_model import STAGE_LABELS as STAGE_1_TO_9_LABELS
from app.wizard.competitive_position import _analysis, _pick, founder_and_research_context
from app.wizard.dfv_assessment import research_data_with_assessment

STAGE_LABELS = {
    **STAGE_1_TO_9_LABELS,
    "business_model": "Stage 11 - Business model",
}
OUTCOMES = ("passed", "failed", "inconclusive", "not_run")


def _research_data(responses: dict[str, WizardResponse]) -> dict:
    """Stage 8's research data and assessment, plus Stages 9 and 10."""
    data = research_data_with_assessment(responses)
    data["stage_9_mvp"] = _pick(
        _analysis(responses, "mvp"), ("offering_type", "name", "summary", "core_features", "how_to_test")
    )
    model = _analysis(responses, "business_model")
    economics = model.get("unit_economics") if isinstance(model.get("unit_economics"), dict) else {}
    inputs = economics.get("inputs") if isinstance(economics.get("inputs"), dict) else {}
    data["stage_10_business_model"] = {
        **_pick(model, ("model_name", "model_type", "key_risks")),
        # Which inputs are guesses -- prime candidates for validation.
        "estimated_inputs": [name for name, figure in inputs.items() if isinstance(figure, dict) and figure.get("is_estimate")],
        "unit_economics_health": economics.get("health"),
        "things_to_complete": [
            t.get("title") for t in model.get("things_to_complete") or [] if isinstance(t, dict)
        ],
    }
    return data


def vp_context(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """The founder's stage 1-10 answers, then the earlier research as untrusted data."""
    return founder_and_research_context(venture, responses, STAGE_LABELS, _research_data(responses))


def based_on(responses: dict[str, WizardResponse]) -> str | None:
    """When the stage 1-10 answers or research this plan used last changed."""
    times = [r.updated_at for slug, r in responses.items() if slug in STAGE_LABELS and r.updated_at]
    return max(times).isoformat() if times else None


def _valid_fail_threshold(comparator: str, pass_at: float, fail_at: float | None) -> float | None:
    """A fail bar on the wrong side of the pass bar is meaningless: dropped."""
    if fail_at is None:
        return None
    if comparator == "at_least":
        return fail_at if fail_at <= pass_at else None
    return fail_at if fail_at >= pass_at else None


def evaluate(experiment: dict, value: float | None) -> str:
    """passed / failed / inconclusive / not_run for one recorded result."""
    if value is None:
        return "not_run"
    pass_at = experiment["pass_threshold"]
    fail_at = experiment.get("fail_threshold")
    if experiment["comparator"] == "at_least":
        if value >= pass_at:
            return "passed"
        return "failed" if fail_at is None or value <= fail_at else "inconclusive"
    if value <= pass_at:
        return "passed"
    return "failed" if fail_at is None or value >= fail_at else "inconclusive"


def summarize(experiments: list[dict], outcomes: dict[str, str]) -> dict:
    """Outcome counts and the decision signal for the current plan."""
    counts = {outcome: 0 for outcome in OUTCOMES}
    for experiment in experiments:
        counts[outcomes.get(experiment["id"], "not_run")] += 1
    critical = [outcomes.get(e["id"], "not_run") for e in experiments if e.get("critical")]
    if counts["not_run"] == len(experiments):
        signal = "not_started"
    elif "failed" in critical:
        signal = "stop_or_pivot"
    elif critical and all(outcome == "passed" for outcome in critical):
        signal = "proceed"
    elif not critical and counts["failed"] == 0 and counts["not_run"] == 0 and counts["inconclusive"] == 0:
        signal = "proceed"
    else:
        signal = "keep_testing"
    return {"counts": counts, "decision_signal": signal}


def finalize_answers(answers: dict, analysis: dict | None) -> dict:
    """Recomputes the server-owned fields from the results and the current plan.

    Results for experiments no longer in the plan are kept (history) but not
    evaluated; outcomes a client sent are always replaced.
    """
    finalized = {
        "riskiest_assumption": "",
        "validation_budget": "",
        "learnings": "",
        "experiment_results": {},
        **answers,
    }
    results = finalized.get("experiment_results") or {}
    experiments = (analysis or {}).get("experiments") if isinstance(analysis, dict) else None
    experiments = [e for e in experiments or [] if isinstance(e, dict) and e.get("id")]
    outcomes = {
        e["id"]: evaluate(e, (results.get(e["id"]) or {}).get("value")) for e in experiments
    }
    finalized["experiment_outcomes"] = outcomes
    finalized["decision_signal"] = summarize(experiments, outcomes)["decision_signal"] if experiments else "not_started"
    return finalized


def vp_payload(
    plan: ValidationPlan,
    language: str,
    researched_at: datetime,
    based_on_at: str | None,
) -> dict:
    experiments = with_action_ids(plan.experiments)
    for experiment in experiments:
        experiment["fail_threshold"] = _valid_fail_threshold(
            experiment["comparator"], experiment["pass_threshold"], experiment["fail_threshold"]
        )
    experiments.sort(key=lambda e: e["phase"])
    return {
        "kind": "validation_plan",
        **plan.model_dump(exclude={"experiments"}),
        "experiments": experiments,
        # No web search in this stage: it plans tests of the evidence so far.
        "sources": [],
        "researched_at": researched_at.isoformat(),
        "based_on": based_on_at,
        "language": language,
    }
