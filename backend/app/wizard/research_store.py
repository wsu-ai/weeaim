"""Saving a stage's AI research result -- shared by the single-call research
endpoint (app/routers/wizard.py) and the stage agents (app/agents/).

The caller has already scoped the session to the organization and commits.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AIRun, AuditLog, Venture, WizardResponse, WizardStage
from app.wizard import financial_analysis, validation_plan


async def save_stage_research(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    venture: Venture,
    stage: WizardStage,
    response: WizardResponse | None,
    analysis: dict,
    initial_answers: dict,
    run: AIRun,
) -> WizardResponse:
    # Every run is kept in ai_runs, so earlier research survives a re-run.
    run.status = "succeeded"
    run.output_payload = analysis
    session.add(run)

    if response is None:
        response = WizardResponse(
            venture_id=venture.id,
            wizard_stage_id=stage.id,
            answers=initial_answers,
            status="in_progress",
        )
        session.add(response)
    response.ai_analysis = analysis
    if stage.slug == "validation_plan":
        response.answers = validation_plan.finalize_answers(response.answers or {}, analysis)
    elif stage.slug == "financial_analysis":
        # Founder-edited inputs are kept; untouched ones follow the new draft.
        response.answers = financial_analysis.finalize_answers(response.answers or {}, analysis, refreshed=True)
    if response.status != "completed":
        response.status = "awaiting_user"
    await session.flush()

    session.add(
        AuditLog(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action="wizard_stage.research",
            resource_type="wizard_response",
            resource_id=response.id,
        )
    )
    return response
