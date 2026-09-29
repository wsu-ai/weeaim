import uuid

from pydantic import BaseModel

from app.ai.schemas import ReportSynthesis


class StageSummary(BaseModel):
    slug: str
    title_en: str
    status: str
    analysis_summary: str | None = None


class EvidenceCitation(BaseModel):
    citation_id: uuid.UUID
    document_id: uuid.UUID
    excerpt: str


class PreliminaryReport(BaseModel):
    venture_id: uuid.UUID
    title: str
    idea_summary: str
    stages: list[StageSummary]
    evidence: list[EvidenceCitation]
    synthesis: ReportSynthesis
