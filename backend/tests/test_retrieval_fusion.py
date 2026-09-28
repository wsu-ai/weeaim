import uuid

from app.documents.retrieval import reciprocal_rank_fusion


def test_item_in_both_lists_outranks_item_in_one():
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    scores = reciprocal_rank_fusion([[a, b], [a, c]])

    assert scores[a] > scores[b]
    assert scores[a] > scores[c]


def test_earlier_rank_scores_higher():
    a, b = uuid.uuid4(), uuid.uuid4()
    scores = reciprocal_rank_fusion([[a, b]])

    assert scores[a] > scores[b]


def test_empty_lists_produce_empty_scores():
    assert reciprocal_rank_fusion([[], []]) == {}
