"""business model stage questions

Revision ID: a6d9e2b4f817
Revises: f2b7d4c8e513
Create Date: 2026-10-12 21:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a6d9e2b4f817'
down_revision: Union[str, Sequence[str], None] = 'f2b7d4c8e513'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "model_adjustments",
            "label_en": "What would you change in this business model?",
            "label_ko": "이 비즈니스 모델에서 무엇을 바꾸고 싶나요?",
            "type": "text",
        },
        {
            "name": "launch_price",
            "label_en": "What price will you launch with, and why?",
            "label_ko": "어떤 가격으로 출시할 것이며, 그 이유는 무엇인가요?",
            "type": "text",
        },
        {
            "name": "first_customers_plan",
            "label_en": "How will you get your first 10 paying customers?",
            "label_ko": "첫 유료 고객 10명을 어떻게 확보할 계획인가요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Define the business model with the strongest chance of success in the "
    "target market, based on stages 1-8, and complete what it still needs."
)
OLD_OBJECTIVE = "Not yet implemented in the vertical slice."


def upgrade() -> None:
    # Data only: Stage 9 becomes a workable stage (see app/wizard/stages.py).
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb), "
            "objective = :objective WHERE slug = 'business_model'"
        ),
        {"schema": json.dumps(QUESTION_SCHEMA), "objective": OBJECTIVE},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = NULL, objective = :objective "
            "WHERE slug = 'business_model'"
        ),
        {"objective": OLD_OBJECTIVE},
    )
