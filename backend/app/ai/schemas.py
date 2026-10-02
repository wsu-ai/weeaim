from typing import Literal

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


class ReportSynthesis(BaseModel):
    summary: str
    key_strengths: list[str]
    key_risks: list[str]
    recommendation: str
    confidence: float = Field(ge=0, le=1)


class ExistingSolution(BaseModel):
    name: str
    description: str
    similarity: Literal["direct", "partial", "adjacent"]
    # The business's official website, as found in the search.
    url: str | None = None


class FactorAssessment(BaseModel):
    rating: Literal["favorable", "moderate", "challenging"]
    reason: str


class FeasibilityFactors(BaseModel):
    """Fixed rubric the model rates; app code turns it into a percentage."""

    technical_complexity: FactorAssessment
    resources_required: FactorAssessment
    regulatory_barriers: FactorAssessment
    time_to_market: FactorAssessment
    customer_access: FactorAssessment


class IdeaResearch(BaseModel):
    """Expert view of an idea, informed by live web research (Stage 1)."""

    summary: str
    # Qualitative label only -- any numeric scoring is done by app code.
    market_status: Literal["no_close_matches_found", "some_similar_offerings", "crowded_market"]
    existing_solutions: list[ExistingSolution] = Field(max_length=8)
    feasibility: list[str]
    feasibility_factors: FeasibilityFactors
    viability: list[str]
    differentiation_opportunities: list[str]
    key_risks: list[str]
    suggested_next_steps: list[str]
    confidence: float = Field(ge=0, le=1)


class ResearchSource(BaseModel):
    title: str
    url: str


class IdeaResearchResult(BaseModel):
    research: IdeaResearch
    # Taken from the search tool's citations, not from the model's own text.
    sources: list[ResearchSource]
    # Every page the search consulted (cited or not), used to confirm that a
    # business's website was really found rather than made up.
    consulted_urls: list[str] = []


class Alternative(BaseModel):
    name: str
    category: Literal["direct_competitor", "indirect_competitor", "substitute", "workaround"]
    description: str
    strengths: list[str]
    weaknesses: list[str]
    pricing: str | None = None
    # The alternative's official website, as found in the search.
    url: str | None = None


class AlternativesResearch(BaseModel):
    """Stage 4: what customers use instead, researched on the web."""

    summary: str
    alternatives: list[Alternative] = Field(max_length=10)
    switching_barriers: list[str]
    unmet_needs: list[str]
    positioning_recommendations: list[str]
    suggested_next_steps: list[str]
    confidence: float = Field(ge=0, le=1)


class AlternativesResearchResult(BaseModel):
    research: AlternativesResearch
    sources: list[ResearchSource]
    consulted_urls: list[str] = []
