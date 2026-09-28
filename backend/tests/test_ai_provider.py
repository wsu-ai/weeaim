import pytest

from app.ai.fake import FakeAIProvider
from app.ai.schemas import IdeaInterpretation


@pytest.mark.asyncio
async def test_fake_provider_returns_idea_interpretation():
    provider = FakeAIProvider()
    result = await provider.structure_idea("An AI cooking assistant for Korean recipes.")

    assert isinstance(result, IdeaInterpretation)
    assert result.title
    assert 0 <= result.confidence <= 1
