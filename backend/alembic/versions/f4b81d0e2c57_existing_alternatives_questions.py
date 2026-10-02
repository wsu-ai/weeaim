"""existing alternatives stage questions

Revision ID: f4b81d0e2c57
Revises: e2a94c7d1b36
Create Date: 2026-10-02 21:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f4b81d0e2c57'
down_revision: Union[str, Sequence[str], None] = 'e2a94c7d1b36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "current_solutions",
            "label_en": "How do your target customers solve this problem today?",
            "label_ko": "목표 고객은 현재 이 문제를 어떻게 해결하고 있나요?",
            "type": "text",
        },
        {
            "name": "why_switch",
            "label_en": "Why would they switch from these alternatives to your solution?",
            "label_ko": "고객이 기존 대안 대신 내 솔루션으로 바꿀 이유는 무엇인가요?",
            "type": "text",
        },
        {
            "name": "biggest_threat",
            "label_en": "Which alternative is the biggest threat, and how will you beat it?",
            "label_ko": "가장 위협적인 대안은 무엇이며, 어떻게 이길 계획인가요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Research the alternatives customers use today -- competitors, substitutes "
    "and workarounds -- based on stages 1-3, and decide how to win against them."
)
OLD_OBJECTIVE = "Not yet implemented in the vertical slice."


def upgrade() -> None:
    # Data only: Stage 4 becomes a workable stage (see app/wizard/stages.py).
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb), "
            "objective = :objective WHERE slug = 'existing_alternatives'"
        ),
        {"schema": json.dumps(QUESTION_SCHEMA), "objective": OBJECTIVE},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = NULL, objective = :objective "
            "WHERE slug = 'existing_alternatives'"
        ),
        {"objective": OLD_OBJECTIVE},
    )
