from app.ai.schemas import IdeaInterpretation


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
