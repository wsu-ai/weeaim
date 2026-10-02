"""idea discovery stage questions

Revision ID: e2a94c7d1b36
Revises: d5e17b3c8f02
Create Date: 2026-10-02 18:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e2a94c7d1b36'
down_revision: Union[str, Sequence[str], None] = 'd5e17b3c8f02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "idea_statement",
            "label_en": "Your idea in your own words",
            "label_ko": "나의 아이디어",
            "type": "text",
        },
        {
            "name": "differentiation_plan",
            "label_en": "Based on the research, how will you differentiate your venture?",
            "label_ko": "조사 결과를 바탕으로, 어떻게 차별화하시겠습니까?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Research whether the idea or similar businesses already exist, get an "
    "expert view of feasibility and viability, and decide where to differentiate."
)
OLD_OBJECTIVE = "Capture the founder's free-text business idea."


def upgrade() -> None:
    # Data only: Stage 1 becomes a workable stage (see app/wizard/stages.py).
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb), "
            "objective = :objective WHERE slug = 'idea_discovery'"
        ),
        {"schema": json.dumps(QUESTION_SCHEMA), "objective": OBJECTIVE},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = NULL, objective = :objective "
            "WHERE slug = 'idea_discovery'"
        ),
        {"objective": OLD_OBJECTIVE},
    )
