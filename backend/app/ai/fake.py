import functools
import inspect
from app.ai.usage import add_tokens
from app.ai.schemas import (
    AgentTurn,
    PersonaMarketFact,
    PersonaMarketProfile,
    PersonaMarketResult,
    PersonaInsight,
    PersonaInsights,
    PersonaReply,
    TranslatedText,
    TranslationBatch,
    FunnelTargets,
    KeyMessage,
    LaunchPhase,
    MarketingChannel,
    MarketingDifferentiator,
    MarketingPlan,
    MarketingPlanResult,
    Persona,
    Driver,
    FinancialDraft,
    FinancialInputs,
    FixedCost,
    Funding,
    OneTimeCost,
    OperatingCost,
    RateDriver,
    RevenueDrivers,
    DecisionRules,
    Experiment,
    RiskyAssumption,
    ValidationPlan,
    JourneyStep,
    MockupFeature,
    MvpConcept,
    MvpFeature,
    OfflineServiceConcept,
    PhysicalProductConcept,
    ServiceDelivery,
    WebsiteMockup,
    AlternativeModel,
    BusinessModel,
    BusinessModelResult,
    CanvasBlocks,
    ModelReason,
    MonthlyChurn,
    Pricing,
    PricingTier,
    ThingToComplete,
    UnitEconomicsInputs,
    ActionItem,
    CompetitivePosition,
    CompetitivePositionResult,
    CompetitorComparison,
    CriterionRating,
    DesirabilityRatings,
    DfvActionItem,
    DfvAssessment,
    Differentiator,
    FeasibilityRatings,
    ViabilityRatings,
    Alternative,
    AlternativesResearch,
    AlternativesResearchResult,
    ExistingSolution,
    FactorAssessment,
    FeasibilityFactors,
    IdeaInterpretation,
    IdeaResearch,
    Demographic,
    IdeaResearchResult,
    MarketResearch,
    MarketResearchResult,
    MarketScope,
    MarketVendor,
    PublishedMarketSize,
    SourcedFigure,
    SourcedShare,
    ReportSynthesis,
    ResearchSource,
    StageAnalysis,
)


class FakeAIProvider:
    """Deterministic stand-in for OpenAIProvider -- no network calls.

    Used in tests (CLAUDE.md bans live AI calls in automated tests) and
    available for local development without an API key.
    """

    async def structure_idea(self, idea_text: str) -> IdeaInterpretation:
        return IdeaInterpretation(
            title=idea_text[:80],
            summary=idea_text,
            industry=None,
            geography=None,
            target_customer=None,
            problem_hypothesis=None,
            confidence=0.5,
        )

    async def analyze_stage(
        self, stage_slug: str, idea_context: str, answers: dict, agent_drafts: dict | None = None
    ) -> StageAnalysis:
        return StageAnalysis(
            summary=f"Fake analysis of {stage_slug}.",
            strengths=["Clear answer provided."],
            gaps=["No real evidence attached yet."],
            suggested_next_steps=["Run a customer interview."],
            confidence=0.5,
        )

    async def produce_report(
        self, idea_context: str, stage_summaries: list[dict], evidence: list[dict]
    ) -> ReportSynthesis:
        return ReportSynthesis(
            summary=f"Fake preliminary report for: {idea_context[:80]}",
            key_strengths=["Clear idea statement."],
            key_risks=["Limited evidence collected so far."],
            recommendation="Proceed to the next validation stage.",
            confidence=0.5,
        )

    async def research_idea(self, idea_context: str, language: str) -> IdeaResearchResult:
        return IdeaResearchResult(
            research=IdeaResearch(
                summary=f"Fake research ({language}) of: {idea_context[:80]}",
                market_status="some_similar_offerings",
                existing_solutions=[
                    ExistingSolution(
                        name="Example Competitor",
                        description="Offers a similar service.",
                        similarity="direct",
                        url="https://example.com/product",
                    ),
                ],
                feasibility=["Can be built with existing tools."],
                feasibility_factors=FeasibilityFactors(
                    technical_complexity=FactorAssessment(rating="favorable", reason="Standard tools."),
                    resources_required=FactorAssessment(rating="moderate", reason="Small team."),
                    regulatory_barriers=FactorAssessment(rating="favorable", reason="Few rules."),
                    time_to_market=FactorAssessment(rating="moderate", reason="A few months."),
                    customer_access=FactorAssessment(rating="challenging", reason="Hard to reach."),
                ),
                viability=["Customers may pay a small subscription."],
                differentiation_opportunities=["Focus on an underserved niche."],
                key_risks=["An established competitor exists."],
                suggested_next_steps=["Interview five potential customers."],
                confidence=0.5,
            ),
            sources=[ResearchSource(title="Example", url="https://example.com/article")],
            consulted_urls=["https://example.com/product"],
        )

    async def research_alternatives(
        self, venture_context: str, language: str
    ) -> AlternativesResearchResult:
        return AlternativesResearchResult(
            research=AlternativesResearch(
                summary=f"Fake alternatives research ({language}).",
                alternatives=[
                    Alternative(
                        name="Example Competitor",
                        category="direct_competitor",
                        description="Does the same thing.",
                        strengths=["Well known."],
                        weaknesses=["Expensive."],
                        pricing="$10/month",
                        url="https://example.com/product",
                    ),
                    Alternative(
                        name="Spreadsheets",
                        category="workaround",
                        description="Customers track it by hand.",
                        strengths=["Free."],
                        weaknesses=["Error-prone."],
                    ),
                ],
                switching_barriers=["Habit."],
                unmet_needs=["Nothing handles X well."],
                positioning_recommendations=["Lead with X."],
                suggested_next_steps=["Interview spreadsheet users."],
                confidence=0.5,
            ),
            sources=[ResearchSource(title="Example", url="https://example.com/article")],
            consulted_urls=["https://example.com/product"],
        )

    async def research_market(self, venture_context: str, language: str) -> MarketResearchResult:
        census = "https://example.com/census"

        def scope(name, area, currency, customers, price):
            return MarketScope(
                scope=name,
                area_name=area,
                currency=currency,
                demographics=[
                    Demographic(
                        segment="Dual-income households",
                        geography=area,
                        description="Households with two working adults.",
                        count=customers,
                        unit="households",
                        year=2024,
                        source_title="Census tables",
                        source_url=census,
                    )
                ],
                total_customers=SourcedFigure(
                    value=customers, unit="households", explanation="From census.",
                    year=2024, source_title="Census tables", source_url=census, is_estimate=False,
                ),
                annual_revenue_per_customer=SourcedFigure(
                    value=price, unit=f"{currency} per year", explanation="Monthly plan x 12.",
                    is_estimate=True,
                ),
                serviceable_share=SourcedShare(
                    value=0.25, unit="share", explanation="Online-ready segment.",
                    source_title="Survey", source_url="https://invented.example.net/survey",
                    is_estimate=False,
                ),
                obtainable_share=SourcedShare(
                    value=0.02, unit="share", explanation="New-entrant benchmark.",
                    is_estimate=True,
                ),
                published_market_sizes=[
                    PublishedMarketSize(
                        label=f"{area} meal kit market", value=customers * price * 2,
                        currency=currency, year=2024, scope=area,
                        publisher="Example Research", source_title="Meal kit report",
                        source_url=census,
                    )
                ],
            )

        return MarketResearchResult(
            research=MarketResearch(
                summary=f"Fake market research ({language}).",
                vendors=[
                    MarketVendor(
                        name="Example Competitor",
                        description="Sells a similar product.",
                        business_model="Subscription",
                        traction="Raised $5M in 2025.",
                        url="https://example.com/product",
                        evidence_url="https://news.example.org/funding",
                    )
                ],
                scopes=[
                    scope("global", "World", "USD", 1_000_000, 120),
                    scope("country", "South Korea", "KRW", 100_000, 120_000),
                    scope("metro", "Seoul", "KRW", 40_000, 120_000),
                ],
                assumptions=["Price holds at $10/month."],
                data_gaps=["No city-level survey data."],
                suggested_next_steps=["Run a pricing survey."],
                confidence=0.5,
            ),
            sources=[ResearchSource(title="Census tables", url=census)],
            consulted_urls=["https://example.com/product"],
        )

    async def research_competitive_position(
        self, venture_context: str, language: str
    ) -> CompetitivePositionResult:
        return CompetitivePositionResult(
            research=CompetitivePosition(
                summary=f"Fake competitive position ({language}).",
                positioning_statement=(
                    "For busy families who want home-cooked Korean food, this is the guided "
                    "cooking service that teaches step by step; unlike meal kits, it builds skills."
                ),
                target_segment="Busy dual-income families",
                market_category="Guided home cooking",
                competitor_comparison=[
                    CompetitorComparison(
                        competitor="Example Competitor",
                        their_position="Convenience at a premium price.",
                        our_advantage="Teaches skills, so customers stay.",
                        our_gap="No brand recognition yet.",
                        url="https://example.com/product",
                    ),
                    CompetitorComparison(
                        competitor="Recipe blogs",
                        their_position="Free and plentiful.",
                        our_advantage="Structured, beginner-first path.",
                        our_gap="Customers must pay.",
                        url="https://invented.example.net/blog",
                    ),
                ],
                differentiators=[
                    Differentiator(
                        claim="Beginner-first coaching.",
                        evidence="Stage 4 found no alternative serves beginners well.",
                        evidence_stage="existing_alternatives",
                    )
                ],
                risks=["A meal-kit company adds coaching."],
                defensibility="Community and recipe progress data make switching costly.",
                action_items=[
                    ActionItem(
                        title="Interview five meal-kit cancellers",
                        why="Tests whether convenience alone keeps Example Competitor's customers.",
                        steps=["Find cancellers in online groups.", "Ask why they left."],
                        priority="high",
                        timeframe="this_week",
                        success_metric="3 of 5 mention wanting to learn.",
                    ),
                    ActionItem(
                        title="Publish a landing page with the positioning statement",
                        why="Checks the message against recipe blogs.",
                        steps=["Write the page.", "Run a small ad test."],
                        priority="high",
                        timeframe="this_month",
                        success_metric="5% sign-up rate.",
                    ),
                    ActionItem(
                        title="Draft a partnership pitch for Korean grocers",
                        why="Closes the brand-recognition gap.",
                        steps=["List ten grocers.", "Send the pitch."],
                        priority="medium",
                        timeframe="this_quarter",
                        success_metric="Two pilot partners.",
                    ),
                ],
                confidence=0.5,
            ),
            sources=[ResearchSource(title="Example", url="https://example.com/article")],
            consulted_urls=["https://example.com/product"],
        )

    async def assess_dfv(self, venture_context: str, language: str) -> DfvAssessment:
        def rate(rating, stage="existing_alternatives", gap=None) -> CriterionRating:
            return CriterionRating(
                rating=rating, reason=f"Rated {rating}.", evidence="From earlier research.",
                evidence_stage=stage, evidence_gap=gap,
            )

        return DfvAssessment(
            summary=f"Fake DFV assessment ({language}).",
            desirability=DesirabilityRatings(
                problem_severity=rate("strong", "problem_definition"),
                demand_evidence=rate("moderate", gap="No pre-orders yet."),
                willingness_to_pay=rate("weak", "none", "No pricing test."),
                differentiation_appeal=rate("strong", "competitive_position"),
            ),
            feasibility=FeasibilityRatings(
                technical_complexity=rate("strong", "idea_discovery"),
                resources_and_team=rate("moderate", "idea_discovery"),
                regulatory_barriers=rate("strong", "idea_discovery"),
                time_to_market=rate("moderate", "idea_discovery"),
            ),
            viability=ViabilityRatings(
                market_size=rate("strong", "market_evidence"),
                revenue_model=rate("moderate", "value_proposition"),
                unit_economics=rate("weak", "none", "No cost data."),
                defensibility=rate("moderate", "competitive_position"),
            ),
            assumptions_to_test=["Families will pay $10 a month."],
            action_items=[
                DfvActionItem(
                    title="Run a pricing test",
                    why="Willingness to pay is the weakest desirability criterion.",
                    steps=["Show three price points.", "Count sign-ups."],
                    priority="high", timeframe="this_week",
                    success_metric="20 sign-ups at $10.",
                    dimension="desirability", criterion="willingness_to_pay",
                ),
                DfvActionItem(
                    title="Estimate cost to serve one family",
                    why="Unit economics are unknown.",
                    steps=["List costs per lesson."],
                    priority="high", timeframe="this_month",
                    success_metric="Cost per customer under $4.",
                    dimension="viability", criterion="unit_economics",
                ),
                DfvActionItem(
                    title="Find a technical co-founder",
                    why="Resources and team are only moderate.",
                    steps=["Post in two founder groups."],
                    priority="medium", timeframe="this_quarter",
                    success_metric="Three candidate conversations.",
                    dimension="feasibility", criterion="resources_and_team",
                ),
            ],
            confidence=0.5,
        )

    async def research_business_model(
        self, venture_context: str, language: str
    ) -> BusinessModelResult:
        benchmarks = "https://example.com/benchmarks"
        return BusinessModelResult(
            research=BusinessModel(
                summary=f"Fake business model ({language}).",
                model_name="Guided cooking subscription",
                model_type="subscription",
                why_this_model=[
                    ModelReason(
                        reason="Recurring lessons match the weekly cooking habit.",
                        evidence_stage="customer_definition",
                    ),
                    ModelReason(
                        reason="Addresses the weak willingness-to-pay rating with a low entry tier.",
                        evidence_stage="dfv_assessment",
                    ),
                ],
                alternatives_considered=[
                    AlternativeModel(
                        name="Meal-kit sales",
                        why_not="Heavy logistics and thin margins.",
                        when_it_would_fit="Once a grocery partner handles delivery.",
                    ),
                    AlternativeModel(
                        name="Advertising-funded app",
                        why_not="Needs a very large audience first.",
                        when_it_would_fit="After 100,000 monthly users.",
                    ),
                ],
                canvas=CanvasBlocks(
                    customer_segments=["Busy dual-income families"],
                    value_propositions=["Learn Korean home cooking step by step"],
                    channels=["Instagram", "Korean grocers"],
                    customer_relationships=["Community challenges"],
                    revenue_streams=["Monthly subscription"],
                    key_resources=["Recipe library", "Coaching content"],
                    key_activities=["Producing lessons"],
                    key_partnerships=["Korean grocers"],
                    cost_structure=["Content production", "Paid acquisition"],
                ),
                pricing=Pricing(
                    strategy="Low entry price, upgrade for live coaching.",
                    tiers=[
                        PricingTier(
                            name="Basic", price="$10 / month", includes=["Recipe lessons"],
                            target_customer="Beginners",
                        ),
                        PricingTier(
                            name="Coach", price="$25 / month", includes=["Live sessions"],
                            target_customer="Committed learners",
                        ),
                    ],
                ),
                unit_economics_inputs=UnitEconomicsInputs(
                    currency="USD",
                    monthly_revenue_per_customer=SourcedFigure(
                        value=12, unit="USD per month", explanation="Blended tiers.",
                        is_estimate=True,
                    ),
                    monthly_cost_to_serve=SourcedFigure(
                        value=3, unit="USD per month", explanation="Hosting and support.",
                        source_title="Benchmarks", source_url=benchmarks, is_estimate=False,
                    ),
                    customer_acquisition_cost=SourcedFigure(
                        value=60, unit="USD", explanation="Paid social benchmark.",
                        source_title="Ad report", source_url="https://invented.example.net/ads",
                        is_estimate=False,
                    ),
                    monthly_churn_rate=MonthlyChurn(
                        value=0.05, unit="share per month", explanation="Subscription benchmark.",
                        source_title="Benchmarks", source_url=benchmarks, is_estimate=False,
                    ),
                ),
                launch_kpis=["Paid conversion rate", "Monthly churn"],
                key_risks=["Churn after the first month."],
                things_to_complete=[
                    ThingToComplete(
                        title="Validate the $10 entry price",
                        why="Revenue per customer is an estimate.",
                        steps=["Run a price test."], priority="high", timeframe="this_week",
                        success_metric="20 paid sign-ups.", area="finances",
                    ),
                    ThingToComplete(
                        title="Sign a grocer partner",
                        why="Key channel is unconfirmed.",
                        steps=["Pitch five grocers."], priority="medium", timeframe="this_month",
                        success_metric="One signed pilot.", area="go_to_market",
                    ),
                    ThingToComplete(
                        title="Measure first-month churn",
                        why="Churn drives lifetime value.",
                        steps=["Track a pilot cohort."], priority="high", timeframe="this_quarter",
                        success_metric="Churn under 5% a month.", area="validation",
                    ),
                ],
                confidence=0.5,
            ),
            sources=[ResearchSource(title="Benchmarks", url=benchmarks)],
            consulted_urls=["https://example.com/product"],
        )

    # The smallest valid WebP header -- enough for the app's signature check.
    FAKE_IMAGE = b"RIFF" + (24).to_bytes(4, "little") + b"WEBPVP8 " + bytes(16)
    # Which kind of MVP the fake returns (tests switch it).
    mvp_offering_type = "physical_product"

    async def research_mvp(self, venture_context: str, language: str) -> MvpConcept:
        offering = self.mvp_offering_type
        for kind in ("physical_product", "online_service", "offline_service"):
            if f"use offering_type '{kind}'" in venture_context:
                offering = kind  # honour the founder's override, like the real model
        return MvpConcept(
            offering_type=offering,
            offering_type_reason="Fake reason.",
            name="KimchiKit Starter",
            tagline="Cook your first kimchi in an evening.",
            summary=f"Fake MVP ({language}).",
            target_user="Busy families new to Korean cooking",
            problem_solved="Korean recipes feel intimidating.",
            core_features=[MvpFeature(feature="Step-by-step guide", why="Beginners need structure.")],
            left_out_for_now=["Live coaching"],
            how_to_test=["Sell 20 kits at a weekend market."],
            physical_product=PhysicalProductConcept(
                image_prompt="A compact ceramic fermentation jar with a bamboo lid and a recipe card.",
                materials=["Ceramic", "Bamboo"],
                dimensions="20 x 15 x 15 cm",
                components=["Jar", "Lid", "Recipe card"],
                prototype_route="Buy off-the-shelf jars and print the cards.",
            ) if offering == "physical_product" else None,
            website_mockup=WebsiteMockup(
                brand_name="KimchiKit",
                primary_color="#b91c1c",
                accent_color="#f59e0b",
                nav_items=["How it works", "Pricing"],
                hero_headline="Cook Korean food with confidence",
                hero_subheadline="Short guided lessons for busy families.",
                cta_label="Start free",
                features=[
                    MockupFeature(title="Guided lessons", description="Step by step.", icon="book"),
                    MockupFeature(title="15-minute meals", description="Weeknight friendly.", icon="clock"),
                ],
                how_it_works=["Pick a recipe", "Follow the steps", "Share your dish"],
                pricing_teaser="From $10 a month.",
                footer_note="Sample page.",
            ) if offering == "online_service" else None,
            offline_service=OfflineServiceConcept(
                overview="Weekend cooking classes in community kitchens.",
                customer_journey=[
                    JourneyStep(step="Book", what_happens="Choose a class online."),
                    JourneyStep(step="Cook", what_happens="Cook with a chef in a small group."),
                ],
                delivery=ServiceDelivery(where="Community kitchens", who_delivers="Local chefs", when="Weekends"),
                what_customer_gets=["A 2-hour class", "Recipe cards"],
                resources_needed=["Kitchen rental", "Ingredients"],
                pricing_note="$40 per class.",
            ) if offering == "offline_service" else None,
            confidence=0.5,
        )

    async def generate_product_image(self, prompt: str) -> bytes:
        return self.FAKE_IMAGE

    async def plan_validation(self, venture_context: str, language: str) -> ValidationPlan:
        def experiment(title, comparator, pass_at, fail_at, critical, phase, method_type="interviews"):
            return Experiment(
                title=title, assumption_tested=f"Assumption behind {title}.", method_type=method_type,
                method="Fake method.", participants="Small landlords", sample_size=10,
                metric="count", unit="interviews", comparator=comparator,
                pass_threshold=pass_at, fail_threshold=fail_at, critical=critical,
                phase=phase, duration_weeks=2, cost_estimate="Low", owner="Founder",
            )

        return ValidationPlan(
            summary=f"Fake validation plan ({language}).",
            prerequisite_fixes=["Align the Stage 5 answers with the idea."],
            assumptions=[
                RiskyAssumption(
                    assumption="Maintenance coordination is a top pain.", dimension="desirability",
                    risk="high", source_stage="dfv_assessment",
                )
            ],
            experiments=[
                experiment("Run 10 problem interviews", "at_least", 6, 3, True, 1),
                experiment("Cut manager minutes per request", "at_most", 10, 20, True, 2, "concierge_pilot"),
                experiment("Collect letters of intent", "at_least", 3, None, False, 2, "pricing_test"),
            ],
            decision_rules=DecisionRules(
                proceed_if="Interviews and the pilot pass.",
                narrow_or_pivot_if="Interviews pass but letters of intent fail.",
                stop_if="Interviews fail.",
            ),
            ethics_and_legal=["Get consent before using tenant data."],
            confidence=0.5,
        )

    async def draft_financials(self, venture_context: str, language: str) -> FinancialDraft:
        return FinancialDraft(
            summary=f"Fake financial draft ({language}).",
            assumption_notes=["Salaries assume one founder at a modest wage."],
            inputs=FinancialInputs(
                currency="USD",
                revenue_drivers=RevenueDrivers(
                    monthly_price_per_customer=Driver(value=100, explanation="Stage 10 price."),
                    starting_customers=Driver(value=0),
                    new_customers_month_1=Driver(value=10),
                    monthly_growth_rate_new_customers=RateDriver(value=0.1),
                    monthly_churn_rate=RateDriver(value=0.05),
                    variable_cost_per_customer=Driver(value=20),
                    customer_acquisition_cost=Driver(value=50),
                ),
                fixed_costs=[
                    FixedCost(name="Founder salary", category="salaries", monthly_amount=3000),
                    FixedCost(name="Co-working desk", category="rent", monthly_amount=300),
                    FixedCost(name="First hire", category="salaries", monthly_amount=2500, start_month=13),
                ],
                operating_costs=[
                    OperatingCost(name="Ads", category="marketing", monthly_amount=500),
                    OperatingCost(name="Card fees", category="payment_fees", percent_of_revenue=0.03),
                ],
                one_time_costs=[OneTimeCost(name="Incorporation", amount=1000, month=1)],
                funding=Funding(starting_cash=50000),
                tax_rate=0.1,
                discount_rate_annual=0.12,
            ),
            confidence=0.5,
        )

    async def research_marketing_plan(
        self, venture_context: str, language: str
    ) -> MarketingPlanResult:
        def channel(name, type_, budget, start, metric, target, url=None):
            return MarketingChannel(
                name=name, type=type_, why=f"Why {name}.", tactics=[f"Tactic for {name}."],
                monthly_budget=budget, start_month=start, kpi_metric=metric, kpi_target=target, url=url,
            )

        return MarketingPlanResult(
            research=MarketingPlan(
                summary=f"Fake marketing plan ({language}).",
                positioning_recap="The guided cooking coach for busy families.",
                currency="USD",
                personas=[
                    Persona(name="Busy parent", description="Works full time.", pains=["No time"], where_to_reach=["Instagram"]),
                    Persona(name="Curious foodie", description="Loves new cuisines.", pains=["Hard recipes"], where_to_reach=["YouTube"]),
                ],
                key_messages=[
                    KeyMessage(message="Learn, don't just reheat.", proof_point="Stage 4: kits teach nothing.", counters="Meal kits"),
                ],
                differentiators=[MarketingDifferentiator(claim="Beginner-first lessons.", versus="Recipe blogs")],
                channels=[
                    channel("Instagram ads", "paid", 300, 1, "sign-ups", 100, "https://example.com/product"),
                    channel("Grocer partnerships", "partnership", 100, 2, "partners", 3),
                    channel("Cooking community", "community", 100, 1, "members", 200, "https://invented.example.net/x"),
                ],
                launch_phases=[
                    LaunchPhase(name="Pre-launch", start_week=0, end_week=4, activities=["Build a waitlist"]),
                    LaunchPhase(name="Launch", start_week=5, end_week=12, activities=["Run ads"]),
                ],
                funnel=FunnelTargets(target_month=6, awareness=10000, leads=800, trials=200, paying=50),
                risks=["Ad costs rise."],
                action_items=[
                    ActionItem(title="Set up a waitlist page", why="Capture early demand.", steps=["Build it."],
                               priority="high", timeframe="this_week", success_metric="100 sign-ups."),
                    ActionItem(title="Pitch three grocers", why="Partnership channel.", steps=["Call them."],
                               priority="medium", timeframe="this_month", success_metric="One yes."),
                    ActionItem(title="Run a 2-week ad test", why="Check acquisition cost.", steps=["Launch ads."],
                               priority="high", timeframe="this_month", success_metric="CAC under $50."),
                ],
                confidence=0.5,
            ),
            sources=[ResearchSource(title="Example", url="https://example.com/article")],
            consulted_urls=["https://example.com/product"],
        )

    async def translate_texts(self, texts: dict[str, str], language: str) -> TranslationBatch:
        return TranslationBatch(
            items=[TranslatedText(key=key, text=f"[{language}] {text}") for key, text in texts.items()]
        )

    async def persona_reply(
        self,
        persona_profile: str,
        venture_brief: str,
        history: list[dict],
        language: str,
        market_evidence: str = "",
    ) -> PersonaReply:
        last = history[-1]["content"] if history else ""
        return PersonaReply(
            message=f"Honestly, I'm not sure I'd pay for that. You asked: {last[:60]}"
        )

    async def summarize_persona_insights(self, venture_context: str, language: str) -> PersonaInsights:
        import re

        ids = re.findall(r'"id": "([0-9a-f-]{36})"', venture_context)
        return PersonaInsights(
            summary=f"Fake persona insights ({language}).",
            per_persona=[
                PersonaInsight(
                    persona_id=persona_id,
                    name="Persona",
                    reactions=["Curious but cautious."],
                    objections=["Price."],
                    willingness_to_pay="some",
                    feasibility_signals=["Would try a free pilot."],
                    viability_signals=["Would pay if it saves an hour a week."],
                    quotes=["Honestly, I'm not sure I'd pay for that.", "An invented quote."],
                )
                for persona_id in dict.fromkeys(ids)
            ],
            assumptions_to_test_with_real_customers=["Landlords will pay for time saved."],
            confidence=0.4,
        )

    async def research_persona_market(
        self, persona_profile: str, venture_brief: str, language: str
    ) -> PersonaMarketResult:
        stats = "https://example.com/census"
        return PersonaMarketResult(
            research=PersonaMarketProfile(
                summary=f"Fake market profile ({language}).",
                facts=[
                    PersonaMarketFact(fact="Most own 2-5 units.", applies_to="demographic",
                                      source_title="Housing survey", source_url=stats),
                    PersonaMarketFact(fact="Median household income is moderate.", applies_to="income",
                                      source_title="Invented blog", source_url="https://invented.example.net/x"),
                ],
                daily_life_and_habits=["Handles requests by phone in the evening."],
                current_alternatives=["KakaoTalk group chats"],
                spending_and_price_sensitivity=["Avoids new monthly fees."],
                adoption_signals=["Uses banking apps daily."],
                likely_objections=["Another app to learn."],
                data_gaps=["No city-level data on software spending."],
                confidence=0.5,
            ),
            sources=[ResearchSource(title="Housing survey", url=stats)],
            consulted_urls=[stats],
        )

    async def agent_turn(
        self,
        *,
        instructions: str,
        input,
        tools: list[dict],
        web_search: bool,
        previous_response_id: str | None,
        output_schema,
        force_final: bool,
    ) -> AgentTurn:
        # Finishes in one turn with the same result as the single-call research
        # (or, for the feedback stages, the same feedback).
        context = input if isinstance(input, str) else ""
        language = "ko" if "Korean" in context.split("\n", 1)[0] else "en"
        calls = {
            IdeaResearch: self.research_idea,
            AlternativesResearch: self.research_alternatives,
            MarketResearch: self.research_market,
            CompetitivePosition: self.research_competitive_position,
            BusinessModel: self.research_business_model,
            MarketingPlan: self.research_marketing_plan,
            DfvAssessment: self.assess_dfv,
            MvpConcept: self.research_mvp,
            ValidationPlan: self.plan_validation,
            FinancialDraft: self.draft_financials,
            PersonaInsights: self.summarize_persona_insights,
        }
        if output_schema is StageAnalysis:
            final = await self.analyze_stage("agent", context, {})
            return AgentTurn(response_id="fake-agent-turn", final=final)
        if output_schema not in calls:
            raise NotImplementedError(f"No fake agent output for {output_schema.__name__}")
        result = await calls[output_schema](context, language)
        if hasattr(result, "research"):  # web research: output plus its sources
            return AgentTurn(
                response_id="fake-agent-turn",
                final=result.research,
                sources=result.sources,
                consulted_urls=result.consulted_urls,
            )
        return AgentTurn(response_id="fake-agent-turn", final=result)


    async def professor_notes(self, stage_context: str, language: str):
        from app.ai.schemas import (
            ClassActivity,
            LearningConcept,
            LearningFramework,
            Misconception,
            ProfessorNotes,
            TeachingStep,
        )

        return ProfessorNotes(
            overview=f"Fake teaching notes ({language}).",
            learning_objectives=["Explain the stage's purpose.", "Apply it to a venture."],
            core_concepts=[
                LearningConcept(name="Problem-solution fit", explanation="A real problem worth solving.", why_it_matters="Avoids building unwanted products."),
                LearningConcept(name="Evidence", explanation="Facts from customers, not opinions.", why_it_matters="Reduces risk."),
            ],
            frameworks=[LearningFramework(name="Lean Startup", how_to_use="Build-measure-learn loops.")],
            teaching_plan=[TeachingStep(minutes=10, activity="Warm-up discussion."), TeachingStep(minutes=30, activity="Case work.")],
            discussion_questions=["What counts as evidence?", "Who feels the problem most?"],
            common_misconceptions=[Misconception(misconception="Friends' praise is validation.", correction="Only behaviour is evidence.")],
            class_activity=ClassActivity(title="Interview drill", instructions=["Pair up.", "Interview."], deliverable="Interview notes."),
            assessment_ideas=["Short reflection."],
            example_from_this_venture="For this venture, interview five target customers.",
        )

    async def study_guide(self, stage_context: str, language: str):
        from app.ai.schemas import ConceptExplained, KeyTerm, PracticeExercise, QuizQuestion, StudyGuide

        return StudyGuide(
            overview=f"Fake study guide ({language}).",
            learning_objectives=["Know the key terms.", "Do the exercise."],
            key_terms=[KeyTerm(term="Customer segment", definition="A group with the same need."), KeyTerm(term="Evidence", definition="Observed facts.")],
            concepts_explained=[
                ConceptExplained(concept="Segments", explanation="Group customers.", example="Busy parents."),
                ConceptExplained(concept="Evidence", explanation="Facts beat opinions.", example="A pre-order."),
            ],
            worked_example="This venture's first segment could be busy parents.",
            self_check=[
                QuizQuestion(question="Which is evidence?", options=["A compliment", "A pre-order"], answer_index=1, explanation="Behaviour counts."),
                QuizQuestion(question="A segment is…", options=["Everyone", "A group with a shared need"], answer_index=1, explanation="Shared need."),
                QuizQuestion(question="Out of range", options=["A", "B"], answer_index=7, explanation="Dropped by app code."),
            ],
            practice_exercise=PracticeExercise(task="Interview two people.", steps=["Write questions.", "Interview."], success_criteria=["Notes saved."]),
            summary_points=["Talk to customers.", "Look for behaviour."],
        )

# Every fake AI call "uses" a fixed number of tokens, so tests can check the
# token accounting (app/tokens.py) without a live API.
FAKE_TOKENS_PER_CALL = 10


def _metered(method):
    @functools.wraps(method)
    async def wrapper(*args, **kwargs):
        add_tokens(FAKE_TOKENS_PER_CALL)
        return await method(*args, **kwargs)

    return wrapper


for _name, _method in list(vars(FakeAIProvider).items()):
    if inspect.iscoroutinefunction(_method) and not _name.startswith("_"):
        setattr(FakeAIProvider, _name, _metered(_method))
