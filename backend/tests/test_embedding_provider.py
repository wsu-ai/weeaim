import pytest

from app.ai.embedding_provider import FakeEmbeddingProvider


@pytest.mark.asyncio
async def test_fake_embedding_provider_returns_correct_dimension():
    provider = FakeEmbeddingProvider(dimensions=1024)
    vectors = await provider.embed(["hello world", "another text"])

    assert len(vectors) == 2
    assert all(len(v) == 1024 for v in vectors)


@pytest.mark.asyncio
async def test_fake_embedding_provider_is_deterministic():
    provider = FakeEmbeddingProvider(dimensions=1024)
    first = await provider.embed(["same text"])
    second = await provider.embed(["same text"])

    assert first == second
