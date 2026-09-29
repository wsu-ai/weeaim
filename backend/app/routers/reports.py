import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.embedding_provider import EmbeddingProvider
from app.auth import AuthContext, get_auth_context
from app.config import settings
from app.db import get_session
from app.dependencies import get_ai_provider, get_embedding_provider
from app.documents.retrieval import retrieve_for_venture
from app.models import AuditLog, WizardResponse, WizardStage
from app.reports.schemas import EvidenceCitation, PreliminaryReport, StageSummary
from app.routers.ventures import _load_venture
from app.wizard.stages import STAGE_ANSWER_SCHEMAS

router = APIRouter(prefix="/api/ventures", tags=["reports"])

EXCERPT_MAX_LENGTH = 300


@router.post("/{venture_id}/report", response_model=PreliminaryReport)
async def generate_report(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
    embedder: EmbeddingProvider = Depends(get_embedding_provider),
) -> PreliminaryReport:
    venture = await _load_venture(session, auth, venture_id)

    stage_rows = (
        await session.execute(
            select(WizardResponse, WizardStage)
            .join(WizardStage, WizardResponse.wizard_stage_id == WizardStage.id)
            .where(
                WizardResponse.venture_id == venture.id,
                WizardStage.slug.in_(STAGE_ANSWER_SCHEMAS.keys()),
            )
        )
    ).all()

    stage_summaries = [
        StageSummary(
            slug=stage.slug,
            title_en=stage.title_en,
            status=response.status,
            analysis_summary=(response.ai_analysis or {}).get("summary"),
        )
        for response, stage in stage_rows
    ]

    idea_context = venture.current_idea_statement or venture.original_idea
    ranked_evidence = await retrieve_for_venture(
        session,
        venture.id,
        embedder,
        idea_context,
        limit=5,
        candidate_pool=settings.retrieval_max_chunks,
    )
    evidence = [
        EvidenceCitation(
            citation_id=chunk.id,
            document_id=chunk.document_id,
            excerpt=chunk.content[:EXCERPT_MAX_LENGTH],
        )
        for chunk, _score in ranked_evidence
    ]

    synthesis = await provider.produce_report(
        idea_context,
        [summary.model_dump() for summary in stage_summaries],
        [citation.model_dump(mode="json") for citation in evidence],
    )

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="report.generate",
            resource_type="venture",
            resource_id=venture.id,
        )
    )
    await session.commit()

    return PreliminaryReport(
        venture_id=venture.id,
        title=venture.title,
        idea_summary=idea_context,
        stages=stage_summaries,
        evidence=evidence,
        synthesis=synthesis,
    )
