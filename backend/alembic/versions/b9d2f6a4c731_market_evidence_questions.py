"""market evidence stage questions

Revision ID: b9d2f6a4c731
Revises: a7c3e5f9d218
Create Date: 2026-10-12 10:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b9d2f6a4c731'
down_revision: Union[str, Sequence[str], None] = 'a7c3e5f9d218'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "beachhead_segment",
            "label_en": "Which customer segment and region will you win first?",
            "label_ko": "가장 먼저 공략할 고객층과 지역은 어디인가요?",
            "type": "text",
        },
        {
            "name": "pricing_assumption",
            "label_en": "What will you charge each customer per year?",
            "label_ko": "고객 한 명당 연간 얼마를 받을 계획인가요?",
            "type": "text",
        },
        {
            "name": "market_takeaways",
            "label_en": "What did the market evidence tell you, and what will you do next?",
            "label_ko": "시장 근거에서 무엇을 알게 되었고, 다음에 무엇을 하실 건가요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Size the market (TAM, SAM, SOM) from sourced figures, see who already does "
    "business in it, and understand which demographics the market comes from."
)
OLD_OBJECTIVE = "Not yet implemented in the vertical slice."


def upgrade() -> None:
    # Data only: Stage 6 becomes a workable stage (see app/wizard/stages.py).
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb), "
            "objective = :objective WHERE slug = 'market_evidence'"
        ),
        {"schema": json.dumps(QUESTION_SCHEMA), "objective": OBJECTIVE},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = NULL, objective = :objective "
            "WHERE slug = 'market_evidence'"
        ),
        {"objective": OLD_OBJECTIVE},
    )
