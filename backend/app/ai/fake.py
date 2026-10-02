from app.ai.schemas import (
    Alternative,
    AlternativesResearch,
    AlternativesResearchResult,
    ExistingSolution,
    FactorAssessment,
    FeasibilityFactors,
    IdeaInterpretation,
    IdeaResearch,
    IdeaResearchResult,
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
        self, stage_slug: str, idea_context: str, answers: dict
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
