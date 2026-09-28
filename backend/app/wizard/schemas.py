import uuid
from datetime import datetime

from pydantic import BaseModel


class ProblemDefinitionAnswers(BaseModel):
    problem_statement: str
    evidence_for_problem: str
    who_experiences_it: str
    frequency_severity: str


class CustomerDefinitionAnswers(BaseModel):
    primary_customer_segment: str
    customer_characteristics: str
    buying_trigger: str


class ValuePropositionAnswers(BaseModel):
    value_proposition_statement: str
    key_benefits: list[str]
    differentiation: str


class StageUpdateRequest(BaseModel):
    answers: dict
    complete: bool = False


class StageStatus(BaseModel):
    slug: str
    number: int
    title_en: str
    title_ko: str
    implemented: bool
    status: str
    answers: dict | None = None
    ai_analysis: dict | None = None
    question_schema: dict | None = None


class StageResponseRead(BaseModel):
    venture_id: uuid.UUID
    stage_slug: str
    status: str
    answers: dict
    ai_analysis: dict | None
    completed_at: datetime | None
