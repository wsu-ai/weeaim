from pydantic import BaseModel, Field


class IdeaInterpretation(BaseModel):
    title: str = Field(max_length=80)
    summary: str
    industry: str | None = None
    geography: str | None = None
    target_customer: str | None = None
    problem_hypothesis: str | None = None
    confidence: float = Field(ge=0, le=1)


class StageAnalysis(BaseModel):
    summary: str
    strengths: list[str]
    gaps: list[str]
    suggested_next_steps: list[str]
    confidence: float = Field(ge=0, le=1)
