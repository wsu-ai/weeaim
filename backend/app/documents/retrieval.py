import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.embedding_provider import EmbeddingProvider
from app.models import DocumentChunk

RRF_K = 60


def reciprocal_rank_fusion(
    ranked_lists: list[list[uuid.UUID]], k: int = RRF_K
) -> dict[uuid.UUID, float]:
    """Merges ranked id lists into one score per id (higher is better).

    Standard Reciprocal Rank Fusion: 1/(k + rank) per list, summed. A chunk
    appearing in both the vector and full-text lists naturally outranks one
    appearing in only one, without needing to calibrate cosine distance and
    ts_rank onto a shared scale.
    """
    scores: dict[uuid.UUID, float] = {}
    for ranked in ranked_lists:
        for rank, item_id in enumerate(ranked, start=1):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + rank)
    return scores


async def retrieve_for_venture(
    session: AsyncSession,
    venture_id: uuid.UUID,
    embedder: EmbeddingProvider,
    query: str,
    limit: int,
    candidate_pool: int,
) -> list[tuple[DocumentChunk, float]]:
    """Tenant-scoped hybrid retrieval, shared by the /retrieve and /report endpoints.

    Combines pgvector cosine similarity with Postgres full-text search via
    reciprocal_rank_fusion. Chunks without an embedding yet are still
    reachable through the full-text path alone.
    """
    (query_vector,) = await embedder.embed([query])

    vector_chunks = (
        await session.execute(
            select(DocumentChunk)
            .where(
                DocumentChunk.venture_id == venture_id,
                DocumentChunk.embedding.is_not(None),
            )
            .order_by(DocumentChunk.embedding.cosine_distance(query_vector))
            .limit(candidate_pool)
        )
    ).scalars().all()

    tsquery = func.plainto_tsquery("simple", query)
    tsvector = func.to_tsvector("simple", DocumentChunk.content)
    fulltext_chunks = (
        await session.execute(
            select(DocumentChunk)
            .where(DocumentChunk.venture_id == venture_id, tsvector.op("@@")(tsquery))
            .order_by(func.ts_rank(tsvector, tsquery).desc())
            .limit(candidate_pool)
        )
    ).scalars().all()

    chunks_by_id = {chunk.id: chunk for chunk in [*vector_chunks, *fulltext_chunks]}
    scores = reciprocal_rank_fusion(
        [[c.id for c in vector_chunks], [c.id for c in fulltext_chunks]]
    )
    ranked_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)[:limit]

    return [(chunks_by_id[chunk_id], scores[chunk_id]) for chunk_id in ranked_ids]
