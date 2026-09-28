import uuid

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
