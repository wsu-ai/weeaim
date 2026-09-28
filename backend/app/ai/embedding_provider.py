import hashlib
from typing import Protocol

from openai import AsyncOpenAI


class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenAIEmbeddingProvider:
    def __init__(self, api_key: str, model: str, dimensions: int, batch_size: int) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._dimensions = dimensions
        self._batch_size = batch_size

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start : start + self._batch_size]
            response = await self._client.embeddings.create(
                model=self._model, input=batch, dimensions=self._dimensions
            )
            vectors.extend(item.embedding for item in response.data)
        return vectors


class FakeEmbeddingProvider:
    """Deterministic stand-in for OpenAIEmbeddingProvider -- no network calls."""

    def __init__(self, dimensions: int = 1024) -> None:
        self._dimensions = dimensions

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._fake_vector(text) for text in texts]

    def _fake_vector(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode()).digest()
        # Repeat the digest bytes to fill the configured dimension, deterministically.
        raw = (digest * (self._dimensions // len(digest) + 1))[: self._dimensions]
        return [byte / 255.0 for byte in raw]
