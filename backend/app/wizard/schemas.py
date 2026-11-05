import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.ai.schemas import MOCKUP_ICONS, FinancialInputs


class IdeaDiscoveryAnswers(BaseModel):
    idea_statement: str
    differentiation_plan: str = ""


class IdeaResearchRequest(BaseModel):
    language: Literal["en", "ko"] = "en"


class ExistingAlternativesAnswers(BaseModel):
    current_solutions: str
    why_switch: str = ""
    biggest_threat: str = ""


class MarketEvidenceAnswers(BaseModel):
    # Where the founder is: Stage 6 sizes the market for this country and city.
    user_country: str = ""
    user_metro_city: str = ""
    beachhead_segment: str = ""
    pricing_assumption: str = ""
    market_takeaways: str = ""


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


class CompetitivePositionAnswers(BaseModel):
    chosen_positioning: str = ""
    main_competitor_focus: str = ""
    first_actions: str = ""
    # IDs of the Stage 7 action items the founder has ticked off.
    completed_actions: list[str] = Field(default_factory=list, max_length=50)


class DfvAssessmentAnswers(BaseModel):
    biggest_risk: str = ""
    evidence_plan: str = ""
    assessment_reflection: str = ""
    # IDs of the Stage 8 action items the founder has ticked off.
    completed_actions: list[str] = Field(default_factory=list, max_length=50)


class BusinessModelAnswers(BaseModel):
    model_adjustments: str = ""
    launch_price: str = ""
    first_customers_plan: str = ""
    # IDs of the Stage 10 "things to complete" the founder has ticked off.
    completed_actions: list[str] = Field(default_factory=list, max_length=50)


HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class DesignFeature(BaseModel):
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(max_length=240)
    icon: Literal[MOCKUP_ICONS]  # type: ignore[valid-type]


class MockupDesign(BaseModel):
    """The founder's own version of the Stage 10 website mock-up, edited in the
    Design Studio. The AI's original stays in the stage's AI content."""

    brand_name: str = Field(min_length=1, max_length=40)
    primary_color: str = Field(pattern=HEX_COLOR)
    accent_color: str = Field(pattern=HEX_COLOR)
    nav_items: list[str] = Field(max_length=5)
    hero_headline: str = Field(min_length=1, max_length=90)
    hero_subheadline: str = Field(max_length=200)
    cta_label: str = Field(min_length=1, max_length=30)
    features: list[DesignFeature] = Field(min_length=2, max_length=6)
    how_it_works: list[str] = Field(max_length=5)
    pricing_teaser: str = Field(max_length=200)
    footer_note: str = Field(max_length=200)

    @model_validator(mode="after")
    def short_list_items(self) -> "MockupDesign":
        if any(len(item) > 30 for item in self.nav_items):
            raise ValueError("Menu items must be 30 characters or fewer")
        if any(len(item) > 200 for item in self.how_it_works):
            raise ValueError("Steps must be 200 characters or fewer")
        return self


class MvpAnswers(BaseModel):
    mvp_scope_changes: str = ""
    build_plan: str = ""
    test_plan: str = ""
    # The founder's override of the AI's offering type ("" = let the AI decide).
    offering_type: Literal["", "physical_product", "online_service", "offline_service"] = ""
    # The founder's edited mock-up from the Design Studio (None = the AI's).
    mockup_design: MockupDesign | None = None


class ExperimentResult(BaseModel):
    value: float | None = None
    notes: str = Field(default="", max_length=2000)


class ValidationPlanAnswers(BaseModel):
    riskiest_assumption: str = ""
    validation_budget: str = ""
    learnings: str = ""
    # The founder's recorded results, by experiment ID.
    experiment_results: dict[str, ExperimentResult] = Field(default_factory=dict, max_length=20)
    # Computed by the server from the results and the current plan (see
    # app/wizard/validation_plan.py); whatever a client sends is replaced.
    experiment_outcomes: dict[str, str] = Field(default_factory=dict)
    decision_signal: str = "not_started"


class FinancialAnalysisAnswers(BaseModel):
    funding_plan: str = ""
    biggest_cost_risk: str = ""
    financial_takeaways: str = ""
    # The projection's inputs: the AI draft until the founder edits them.
    financial_inputs: FinancialInputs | None = None
    # Computed by the server (app/wizard/financial_analysis.py); whatever a
    # client sends is replaced.
    inputs_source: str = "ai_draft"
    projection: dict | None = None


class MarketingPlanAnswers(BaseModel):
    first_channel: str = ""
    marketing_budget: str = ""
    success_90_days: str = ""
    # IDs of the Stage 13 action items the founder has ticked off.
    completed_actions: list[str] = Field(default_factory=list, max_length=50)


class TargetPersona(BaseModel):
    """A target persona the founder defines in Stage 7."""

    # Assigned by the server when missing; kept across edits.
    id: str = Field(default="", max_length=36)
    name: str = Field(min_length=1, max_length=60)
    age_min: int = Field(ge=0, le=120)
    age_max: int = Field(ge=0, le=120)
    demographic: str = Field(default="", max_length=300)
    income_level: Literal["low", "lower_middle", "middle", "upper_middle", "high"]
    gender: Literal["female", "male", "non_binary", "any"]
    marital_status: Literal["single", "married", "divorced", "widowed", "any"]
    notes: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def ages_in_order(self) -> "TargetPersona":
        if self.age_min > self.age_max:
            raise ValueError("age_min must not be greater than age_max")
        return self


class PersonaValidationAnswers(BaseModel):
    validation_takeaways: str = ""
    next_real_test: str = ""
    personas: list[TargetPersona] = Field(default_factory=list, max_length=5)


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
    # Locked until its prerequisite stages are completed (see STAGE_PREREQUISITES).
    locked: bool = False
    locked_by: list[str] = []


class StageResponseRead(BaseModel):
    venture_id: uuid.UUID
    stage_slug: str
    status: str
    answers: dict
    ai_analysis: dict | None
    completed_at: datetime | None


class StageRevisionRead(BaseModel):
    version_number: int
    answers: dict
    status: str
    created_at: datetime
