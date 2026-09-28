from app.ai.schemas import IdeaInterpretation, StageAnalysis


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
