"""validation plan stage questions

Revision ID: d9a3f6b1c824
Revises: c8f4a2d6e391
Create Date: 2026-10-13 14:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd9a3f6b1c824'
down_revision: Union[str, Sequence[str], None] = 'c8f4a2d6e391'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "riskiest_assumption",
            "label_en": "Which assumption worries you most, and why?",
            "label_ko": "가장 걱정되는 가정은 무엇이며, 그 이유는 무엇인가요?",
            "type": "text",
        },
        {
            "name": "validation_budget",
            "label_en": "How much time and money can you commit to validation?",
            "label_ko": "검증에 얼마의 시간과 비용을 쓸 수 있나요?",
            "type": "text",
        },
        {
            "name": "learnings",
            "label_en": "What have you learned so far?",
            "label_ko": "지금까지 무엇을 배웠나요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Test the riskiest assumptions with cheap experiments whose pass/fail bars "
    "are set in advance, and record the results."
)
OLD_OBJECTIVE = "Not yet implemented in the vertical slice."


def upgrade() -> None:
    # Data only: Stage 11 becomes a workable stage (see app/wizard/stages.py).
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb), "
            "objective = :objective WHERE slug = 'validation_plan'"
        ),
        {"schema": json.dumps(QUESTION_SCHEMA), "objective": OBJECTIVE},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = NULL, objective = :objective "
            "WHERE slug = 'validation_plan'"
        ),
        {"objective": OLD_OBJECTIVE},
    )
