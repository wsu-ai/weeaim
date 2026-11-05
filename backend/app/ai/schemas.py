from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


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


class MarketVendor(BaseModel):
    """A company actually doing business in this market (the business case)."""

    name: str
    description: str
    business_model: str
    # Evidence of real business: revenue, funding, customers, founding year...
    traction: str
    url: str | None = None
    evidence_url: str | None = None


class Demographic(BaseModel):
    """A target population the market figures are built from."""

    segment: str
    geography: str
    description: str
    count: float = Field(ge=0)
    unit: Literal["people", "households", "businesses", "organizations"]
    year: int | None = None
    source_title: str | None = None
    source_url: str | None = None


class SourcedFigure(BaseModel):
    value: float = Field(ge=0)
    unit: str
    explanation: str
    year: int | None = None
    source_title: str | None = None
    source_url: str | None = None
    # True when the value is the model's estimate rather than a sourced fact.
    is_estimate: bool


class SourcedShare(SourcedFigure):
    value: float = Field(ge=0, le=1)


class PublishedMarketSize(BaseModel):
    label: str
    value: float = Field(ge=0)
    currency: str
    year: int | None = None
    scope: str
    publisher: str
    source_title: str
    source_url: str | None = None


class MarketScope(BaseModel):
    """Sourced sizing inputs for one geography (global, the user's country,
    or the user's metropolitan city). App code computes TAM/SAM/SOM from them."""

    scope: Literal["global", "country", "metro"]
    area_name: str
    currency: str
    demographics: list[Demographic] = Field(max_length=4)
    total_customers: SourcedFigure
    annual_revenue_per_customer: SourcedFigure
    serviceable_share: SourcedShare
    obtainable_share: SourcedShare
    published_market_sizes: list[PublishedMarketSize] = Field(max_length=3)


class MarketResearch(BaseModel):
    """Stage 6 inputs. Deliberately has no TAM/SAM/SOM: app code computes them
    from these sourced inputs (CLAUDE.md: no LLM financial calculations)."""

    summary: str
    vendors: list[MarketVendor] = Field(max_length=8)
    scopes: list[MarketScope] = Field(min_length=1, max_length=3)
    assumptions: list[str]
    data_gaps: list[str]
    suggested_next_steps: list[str]
    confidence: float = Field(ge=0, le=1)


class MarketResearchResult(BaseModel):
    research: MarketResearch
    sources: list[ResearchSource]
    consulted_urls: list[str] = []


class CompetitorComparison(BaseModel):
    """Where one competitor stands, and where this venture wins or falls short."""

    competitor: str
    their_position: str
    our_advantage: str
    our_gap: str
    url: str | None = None


class Differentiator(BaseModel):
    claim: str
    evidence: str
    # Which earlier stage the evidence comes from.
    evidence_stage: Literal["idea_discovery", "existing_alternatives", "market_evidence", "founder_answers"]


class ActionItem(BaseModel):
    title: str
    why: str
    steps: list[str] = Field(min_length=1, max_length=6)
    priority: Literal["high", "medium", "low"]
    timeframe: Literal["this_week", "this_month", "this_quarter"]
    success_metric: str


class CompetitivePosition(BaseModel):
    """Stage 7: a competitive position synthesized from the Stage 1, 4 and 6
    research, turned into action items for the founder."""

    summary: str
    positioning_statement: str
    target_segment: str
    market_category: str
    competitor_comparison: list[CompetitorComparison] = Field(max_length=6)
    differentiators: list[Differentiator] = Field(max_length=6)
    risks: list[str]
    defensibility: str
    action_items: list[ActionItem] = Field(min_length=3, max_length=10)
    confidence: float = Field(ge=0, le=1)


class CompetitivePositionResult(BaseModel):
    research: CompetitivePosition
    sources: list[ResearchSource]
    consulted_urls: list[str] = []


class CriterionRating(BaseModel):
    """The model's rating of one DFV criterion. Deliberately no score: app
    code turns ratings into scores (CLAUDE.md: deterministic scoring)."""

    rating: Literal["strong", "moderate", "weak"]
    reason: str
    evidence: str
    evidence_stage: Literal[
        "idea_discovery",
        "problem_definition",
        "customer_definition",
        "existing_alternatives",
        "value_proposition",
        "market_evidence",
        "competitive_position",
        "none",
    ]
    # What evidence is missing to rate this with confidence, if anything.
    evidence_gap: str | None = None


# One required field per criterion, so a criterion can't be skipped or repeated.
class DesirabilityRatings(BaseModel):
    problem_severity: CriterionRating
    demand_evidence: CriterionRating
    willingness_to_pay: CriterionRating
    differentiation_appeal: CriterionRating


class FeasibilityRatings(BaseModel):
    technical_complexity: CriterionRating
    resources_and_team: CriterionRating
    regulatory_barriers: CriterionRating
    time_to_market: CriterionRating


class ViabilityRatings(BaseModel):
    market_size: CriterionRating
    revenue_model: CriterionRating
    unit_economics: CriterionRating
    defensibility: CriterionRating


class DfvActionItem(ActionItem):
    dimension: Literal["desirability", "feasibility", "viability"]
    # The criterion this action strengthens, e.g. "willingness_to_pay".
    criterion: str


class DfvAssessment(BaseModel):
    """Stage 8: desirability, feasibility and viability rated from the
    evidence gathered in stages 1-7, with actions for the weakest criteria."""

    summary: str
    desirability: DesirabilityRatings
    feasibility: FeasibilityRatings
    viability: ViabilityRatings
    assumptions_to_test: list[str] = Field(max_length=8)
    action_items: list[DfvActionItem] = Field(min_length=3, max_length=10)
    confidence: float = Field(ge=0, le=1)


class ModelReason(BaseModel):
    reason: str
    evidence_stage: Literal[
        "idea_discovery",
        "problem_definition",
        "customer_definition",
        "existing_alternatives",
        "value_proposition",
        "market_evidence",
        "competitive_position",
        "dfv_assessment",
        "mvp",
        "founder_answers",
    ]


class AlternativeModel(BaseModel):
    """A business model considered and not recommended (for now)."""

    name: str
    why_not: str
    when_it_would_fit: str


class CanvasBlocks(BaseModel):
    """The nine Business Model Canvas blocks."""

    customer_segments: list[str] = Field(min_length=1, max_length=6)
    value_propositions: list[str] = Field(min_length=1, max_length=6)
    channels: list[str] = Field(min_length=1, max_length=6)
    customer_relationships: list[str] = Field(min_length=1, max_length=6)
    revenue_streams: list[str] = Field(min_length=1, max_length=6)
    key_resources: list[str] = Field(min_length=1, max_length=6)
    key_activities: list[str] = Field(min_length=1, max_length=6)
    key_partnerships: list[str] = Field(min_length=1, max_length=6)
    cost_structure: list[str] = Field(min_length=1, max_length=6)


class PricingTier(BaseModel):
    name: str
    # Price as text (e.g. "KRW 12,900 / month"); the app's calculations use
    # monthly_revenue_per_customer below, not this text.
    price: str
    includes: list[str] = Field(max_length=8)
    target_customer: str


class Pricing(BaseModel):
    strategy: str
    tiers: list[PricingTier] = Field(min_length=1, max_length=4)


class MonthlyChurn(SourcedFigure):
    # Share of customers lost per month; above 0 so lifetime is finite.
    value: float = Field(gt=0, le=1)


class UnitEconomicsInputs(BaseModel):
    """Sourced inputs only. App code computes margin, LTV, LTV:CAC and payback
    (CLAUDE.md: no LLM financial calculations)."""

    currency: str
    monthly_revenue_per_customer: SourcedFigure
    monthly_cost_to_serve: SourcedFigure
    customer_acquisition_cost: SourcedFigure
    monthly_churn_rate: MonthlyChurn


class ThingToComplete(ActionItem):
    area: Literal["customers", "offering", "go_to_market", "operations", "finances", "validation"]


class BusinessModel(BaseModel):
    """Stage 10: the recommended business model, synthesized from stages 1-9."""

    summary: str
    model_name: str
    model_type: Literal[
        "subscription",
        "marketplace",
        "transaction_fee",
        "one_time_sale",
        "freemium",
        "licensing",
        "hardware_plus_service",
        "advertising",
        "service",
        "other",
    ]
    why_this_model: list[ModelReason] = Field(min_length=1, max_length=6)
    alternatives_considered: list[AlternativeModel] = Field(max_length=3)
    canvas: CanvasBlocks
    pricing: Pricing
    unit_economics_inputs: UnitEconomicsInputs
    launch_kpis: list[str] = Field(max_length=8)
    key_risks: list[str] = Field(max_length=8)
    things_to_complete: list[ThingToComplete] = Field(min_length=3, max_length=12)
    confidence: float = Field(ge=0, le=1)


class BusinessModelResult(BaseModel):
    research: BusinessModel
    sources: list[ResearchSource]
    consulted_urls: list[str] = []


OfferingType = Literal["physical_product", "online_service", "offline_service"]
# Icons the website mockup can use; the frontend maps each to a lucide icon.
MOCKUP_ICONS = (
    "sparkles", "clock", "shield", "heart", "users", "chart", "calendar", "chat",
    "map", "star", "leaf", "book", "camera", "cart", "bell", "lightning",
)


class MvpFeature(BaseModel):
    feature: str
    why: str


class PhysicalProductConcept(BaseModel):
    # A detailed visual description used to generate the concept image.
    image_prompt: str
    materials: list[str] = Field(max_length=8)
    dimensions: str
    components: list[str] = Field(max_length=10)
    prototype_route: str


class MockupFeature(BaseModel):
    title: str
    description: str
    icon: Literal[MOCKUP_ICONS]  # type: ignore[valid-type]


class WebsiteMockup(BaseModel):
    """Content for a sample landing page. Rendered by the app's own component:
    the model never writes HTML. Colours and lengths are checked by app code
    (app/wizard/mvp.py), so one bad value doesn't fail the whole run."""

    brand_name: str
    primary_color: str
    accent_color: str
    nav_items: list[str] = Field(max_length=5)
    hero_headline: str
    hero_subheadline: str
    cta_label: str
    features: list[MockupFeature] = Field(min_length=2, max_length=6)
    how_it_works: list[str] = Field(max_length=5)
    pricing_teaser: str
    footer_note: str


class JourneyStep(BaseModel):
    step: str
    what_happens: str


class ServiceDelivery(BaseModel):
    where: str
    who_delivers: str
    when: str


class OfflineServiceConcept(BaseModel):
    overview: str
    customer_journey: list[JourneyStep] = Field(min_length=2, max_length=8)
    delivery: ServiceDelivery
    what_customer_gets: list[str] = Field(max_length=8)
    resources_needed: list[str] = Field(max_length=8)
    pricing_note: str


class MvpConcept(BaseModel):
    """Stage 9: the minimum viable product or service. Exactly one detail
    section is filled, matching offering_type."""

    offering_type: OfferingType
    offering_type_reason: str
    name: str
    tagline: str
    summary: str
    target_user: str
    problem_solved: str
    core_features: list[MvpFeature] = Field(min_length=1, max_length=6)
    left_out_for_now: list[str] = Field(max_length=6)
    how_to_test: list[str] = Field(min_length=1, max_length=6)
    physical_product: PhysicalProductConcept | None = None
    website_mockup: WebsiteMockup | None = None
    offline_service: OfflineServiceConcept | None = None
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def one_matching_detail_section(self) -> "MvpConcept":
        """The section matching offering_type is required; any other is dropped."""
        fields = {
            "physical_product": "physical_product",
            "online_service": "website_mockup",
            "offline_service": "offline_service",
        }
        if getattr(self, fields[self.offering_type]) is None:
            raise ValueError(f"offering_type {self.offering_type!r} needs its {fields[self.offering_type]} section")
        for kind, field in fields.items():
            if kind != self.offering_type:
                setattr(self, field, None)
        return self


class RiskyAssumption(BaseModel):
    assumption: str
    dimension: Literal["desirability", "feasibility", "viability", "legal"]
    risk: Literal["high", "medium", "low"]
    source_stage: str


class Experiment(BaseModel):
    """One validation experiment with its pass/fail bar set in advance.
    The model never states an outcome: app code evaluates the founder's
    recorded result against these thresholds."""

    title: str
    assumption_tested: str
    method_type: Literal[
        "interviews",
        "baseline_log",
        "competitor_check",
        "concierge_pilot",
        "technical_test",
        "pricing_test",
        "landing_page",
        "legal_review",
        "other",
    ]
    method: str
    participants: str
    sample_size: int | None = None
    metric: str
    unit: str
    comparator: Literal["at_least", "at_most"]
    pass_threshold: float
    # Beyond this the experiment has failed; between the two it's inconclusive.
    fail_threshold: float | None = None
    critical: bool
    phase: int = Field(ge=1, le=3)
    duration_weeks: int = Field(ge=1, le=26)
    cost_estimate: str
    owner: str


class DecisionRules(BaseModel):
    proceed_if: str
    narrow_or_pivot_if: str
    stop_if: str


class ValidationPlan(BaseModel):
    """Stage 11: experiments for the riskiest assumptions from stages 1-10."""

    summary: str
    prerequisite_fixes: list[str] = Field(max_length=6)
    assumptions: list[RiskyAssumption] = Field(min_length=1, max_length=8)
    experiments: list[Experiment] = Field(min_length=3, max_length=8)
    decision_rules: DecisionRules
    ethics_and_legal: list[str] = Field(max_length=6)
    confidence: float = Field(ge=0, le=1)


HORIZON_MONTHS = 36


class Driver(BaseModel):
    """One revenue driver: a number, why, and whether it's a guess."""

    value: float = Field(ge=0)
    explanation: str = ""
    is_estimate: bool = True


class RateDriver(Driver):
    value: float = Field(ge=0, le=1)


class RevenueDrivers(BaseModel):
    monthly_price_per_customer: Driver
    starting_customers: Driver
    new_customers_month_1: Driver
    monthly_growth_rate_new_customers: RateDriver
    monthly_churn_rate: RateDriver
    variable_cost_per_customer: Driver
    customer_acquisition_cost: Driver


class FixedCost(BaseModel):
    name: str
    category: Literal["salaries", "rent", "software", "insurance", "legal_accounting", "utilities", "other"]
    monthly_amount: float = Field(ge=0)
    start_month: int = Field(default=1, ge=1, le=HORIZON_MONTHS)
    note: str = ""


class OperatingCost(BaseModel):
    """A flat monthly amount, a share of revenue, or both."""

    name: str
    category: Literal["marketing", "ai_infrastructure", "payment_fees", "travel", "support", "other"]
    monthly_amount: float = Field(default=0, ge=0)
    percent_of_revenue: float = Field(default=0, ge=0, le=1)
    start_month: int = Field(default=1, ge=1, le=HORIZON_MONTHS)
    note: str = ""


class OneTimeCost(BaseModel):
    name: str
    amount: float = Field(ge=0)
    month: int = Field(default=1, ge=1, le=HORIZON_MONTHS)
    note: str = ""


class Funding(BaseModel):
    starting_cash: float = Field(ge=0)
    planned_raise_amount: float = Field(default=0, ge=0)
    planned_raise_month: int | None = Field(default=None, ge=1, le=HORIZON_MONTHS)


class FinancialInputs(BaseModel):
    """Every input to the projection. Drafted by the AI, edited by the founder;
    all figures derived from it are computed by app/wizard/financials.py."""

    currency: str
    revenue_drivers: RevenueDrivers
    fixed_costs: list[FixedCost] = Field(max_length=25)
    operating_costs: list[OperatingCost] = Field(max_length=25)
    one_time_costs: list[OneTimeCost] = Field(max_length=25)
    funding: Funding
    tax_rate: float = Field(ge=0, le=1)
    discount_rate_annual: float = Field(ge=0, le=1)


class FinancialDraft(BaseModel):
    """Stage 12: the AI's draft inputs. Deliberately no totals, IRR, break-even,
    runway or burn: app code computes them (CLAUDE.md)."""

    summary: str
    assumption_notes: list[str] = Field(max_length=10)
    inputs: FinancialInputs
    confidence: float = Field(ge=0, le=1)


class Persona(BaseModel):
    name: str
    description: str
    pains: list[str] = Field(max_length=5)
    where_to_reach: list[str] = Field(max_length=5)


class KeyMessage(BaseModel):
    message: str
    proof_point: str
    counters: str  # the alternative this message wins against


class MarketingDifferentiator(BaseModel):
    claim: str
    versus: str


class MarketingChannel(BaseModel):
    name: str
    type: Literal["organic", "paid", "partnership", "direct_sales", "community", "events", "referral"]
    why: str
    tactics: list[str] = Field(min_length=1, max_length=5)
    monthly_budget: float = Field(ge=0)
    start_month: int = Field(ge=1, le=36)
    kpi_metric: str
    kpi_target: float = Field(ge=0)
    url: str | None = None


class LaunchPhase(BaseModel):
    name: str
    start_week: int = Field(ge=0, le=104)
    end_week: int = Field(ge=0, le=104)
    activities: list[str] = Field(min_length=1, max_length=6)


class FunnelTargets(BaseModel):
    target_month: int = Field(ge=1, le=36)
    awareness: float = Field(ge=0)
    leads: float = Field(ge=0)
    trials: float = Field(ge=0)
    paying: float = Field(ge=0)


class MarketingPlan(BaseModel):
    """Stage 13: a competitive, differentiated marketing plan. Deliberately no
    totals or conversion rates: app code computes them."""

    summary: str
    positioning_recap: str
    currency: str
    personas: list[Persona] = Field(min_length=2, max_length=4)
    key_messages: list[KeyMessage] = Field(min_length=1, max_length=5)
    differentiators: list[MarketingDifferentiator] = Field(max_length=5)
    channels: list[MarketingChannel] = Field(min_length=3, max_length=8)
    launch_phases: list[LaunchPhase] = Field(min_length=2, max_length=4)
    funnel: FunnelTargets
    risks: list[str] = Field(max_length=6)
    action_items: list[ActionItem] = Field(min_length=3, max_length=10)
    confidence: float = Field(ge=0, le=1)


class MarketingPlanResult(BaseModel):
    research: MarketingPlan
    sources: list[ResearchSource]
    consulted_urls: list[str] = []


class TranslatedText(BaseModel):
    key: str
    text: str


class TranslationBatch(BaseModel):
    """Translated strings, each under the key it was sent with."""

    items: list[TranslatedText]


class PersonaReply(BaseModel):
    """One in-character reply from an AI persona (Stage 7)."""

    message: str


class PersonaInsight(BaseModel):
    persona_id: str
    name: str
    reactions: list[str] = Field(max_length=6)
    objections: list[str] = Field(max_length=6)
    willingness_to_pay: Literal["strong", "some", "none", "unclear"]
    feasibility_signals: list[str] = Field(max_length=6)
    viability_signals: list[str] = Field(max_length=6)
    # Verbatim sentences from the persona's replies (checked by app code).
    quotes: list[str] = Field(max_length=4)


class PersonaInsights(BaseModel):
    """Stage 7: what the persona conversations suggest -- simulated, so every
    signal is a hypothesis to test with real customers."""

    summary: str
    per_persona: list[PersonaInsight] = Field(max_length=5)
    assumptions_to_test_with_real_customers: list[str] = Field(min_length=1, max_length=8)
    confidence: float = Field(ge=0, le=1)


class PersonaMarketFact(BaseModel):
    """One fact about people matching the persona in the target market."""

    fact: str
    applies_to: Literal["age", "income", "gender", "marital_status", "demographic", "location", "category"]
    source_title: str | None = None
    source_url: str | None = None


class PersonaMarketProfile(BaseModel):
    """What the general market says about people matching a persona's
    criteria, from web search -- used to ground the AI persona's replies."""

    summary: str
    facts: list[PersonaMarketFact] = Field(max_length=10)
    daily_life_and_habits: list[str] = Field(max_length=5)
    current_alternatives: list[str] = Field(max_length=5)
    spending_and_price_sensitivity: list[str] = Field(max_length=5)
    adoption_signals: list[str] = Field(max_length=5)
    likely_objections: list[str] = Field(max_length=5)
    data_gaps: list[str] = Field(max_length=5)
    confidence: float = Field(ge=0, le=1)


class PersonaMarketResult(BaseModel):
    research: PersonaMarketProfile
    sources: list[ResearchSource]
    consulted_urls: list[str] = []


class AgentToolCall(BaseModel):
    """A function call the model asked for; arguments is its raw JSON."""

    call_id: str
    name: str
    arguments: str


class AgentTurn(BaseModel):
    """One model turn of an agent run (see app/agents/runner.py).

    Either tool_calls (the loop runs them and continues) or final (the
    parsed stage output) is set.
    """

    response_id: str
    tool_calls: list[AgentToolCall] = []
    final: Any = None
    sources: list[ResearchSource] = []
    consulted_urls: list[str] = []
    web_searches: int = 0
    tokens: int = 0


# --- Learning materials for a stage (Professor Notes, Study Guide) ------------------------------


class LearningConcept(BaseModel):
    name: str
    explanation: str
    why_it_matters: str


class LearningFramework(BaseModel):
    name: str
    how_to_use: str


class TeachingStep(BaseModel):
    minutes: int = Field(ge=1, le=120)
    activity: str


class Misconception(BaseModel):
    misconception: str
    correction: str


class ClassActivity(BaseModel):
    title: str
    instructions: list[str] = Field(min_length=1, max_length=8)
    deliverable: str


class ProfessorNotes(BaseModel):
    """For a teacher: the principles and concepts behind one wizard stage, and
    how to teach them."""

    overview: str
    learning_objectives: list[str] = Field(min_length=2, max_length=6)
    core_concepts: list[LearningConcept] = Field(min_length=2, max_length=8)
    frameworks: list[LearningFramework] = Field(max_length=5)
    teaching_plan: list[TeachingStep] = Field(min_length=2, max_length=8)
    discussion_questions: list[str] = Field(min_length=2, max_length=8)
    common_misconceptions: list[Misconception] = Field(max_length=6)
    class_activity: ClassActivity
    assessment_ideas: list[str] = Field(min_length=1, max_length=6)
    example_from_this_venture: str


class KeyTerm(BaseModel):
    term: str
    definition: str


class ConceptExplained(BaseModel):
    concept: str
    explanation: str
    example: str


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(min_length=2, max_length=5)
    answer_index: int = Field(ge=0)
    explanation: str


class PracticeExercise(BaseModel):
    task: str
    steps: list[str] = Field(min_length=1, max_length=8)
    success_criteria: list[str] = Field(min_length=1, max_length=6)


class StudyGuide(BaseModel):
    """For a student: what to understand in one wizard stage, explained
    simply, with a self-check quiz and an exercise."""

    overview: str
    learning_objectives: list[str] = Field(min_length=2, max_length=6)
    key_terms: list[KeyTerm] = Field(min_length=2, max_length=12)
    concepts_explained: list[ConceptExplained] = Field(min_length=2, max_length=8)
    worked_example: str
    self_check: list[QuizQuestion] = Field(min_length=3, max_length=8)
    practice_exercise: PracticeExercise
    summary_points: list[str] = Field(min_length=2, max_length=8)
