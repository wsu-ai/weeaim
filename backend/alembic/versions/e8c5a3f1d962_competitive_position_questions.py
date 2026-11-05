"""competitive position stage questions

Revision ID: e8c5a3f1d962
Revises: d7f3b2e9a145
Create Date: 2026-10-12 17:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e8c5a3f1d962'
down_revision: Union[str, Sequence[str], None] = 'd7f3b2e9a145'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "chosen_positioning",
            "label_en": "Your positioning statement, in your own words",
            "label_ko": "내 말로 쓴 포지셔닝 문장",
            "type": "text",
        },
        {
            "name": "main_competitor_focus",
            "label_en": "Which competitor will you position against first, and why?",
            "label_ko": "어떤 경쟁자를 먼저 상대로 포지셔닝할 것이며, 그 이유는 무엇인가요?",
            "type": "text",
        },
        {
            "name": "first_actions",
            "label_en": "Which action items will you start this week?",
            "label_ko": "이번 주에 시작할 실행 항목은 무엇인가요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Turn the research from stages 1, 4 and 6 into a clear competitive "
    "position, and follow it through with concrete action items."
)
OLD_OBJECTIVE = "Not yet implemented in the vertical slice."


def upgrade() -> None:
    # Data only: Stage 7 becomes a workable stage (see app/wizard/stages.py).
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb), "
            "objective = :objective WHERE slug = 'competitive_position'"
        ),
        {"schema": json.dumps(QUESTION_SCHEMA), "objective": OBJECTIVE},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = NULL, objective = :objective "
            "WHERE slug = 'competitive_position'"
        ),
        {"objective": OLD_OBJECTIVE},
    )
