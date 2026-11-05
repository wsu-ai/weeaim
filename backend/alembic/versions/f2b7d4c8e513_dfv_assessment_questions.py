"""dfv assessment stage questions

Revision ID: f2b7d4c8e513
Revises: e8c5a3f1d962
Create Date: 2026-10-12 19:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f2b7d4c8e513'
down_revision: Union[str, Sequence[str], None] = 'e8c5a3f1d962'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "biggest_risk",
            "label_en": "Which dimension is your biggest risk, and why?",
            "label_ko": "가장 큰 위험이 있는 영역은 무엇이며, 그 이유는 무엇인가요?",
            "type": "text",
        },
        {
            "name": "evidence_plan",
            "label_en": "What evidence will you gather next to strengthen it?",
            "label_ko": "이를 보강하기 위해 다음에 어떤 근거를 모을 계획인가요?",
            "type": "text",
        },
        {
            "name": "assessment_reflection",
            "label_en": "Do you agree with this assessment? What would you change?",
            "label_ko": "이 평가에 동의하나요? 무엇을 바꾸고 싶나요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Assess desirability, feasibility and viability from the evidence gathered "
    "in stages 1-7, and act on the weakest areas."
)
OLD_OBJECTIVE = "Not yet implemented in the vertical slice."


def upgrade() -> None:
    # Data only: Stage 8 becomes a workable stage (see app/wizard/stages.py).
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb), "
            "objective = :objective WHERE slug = 'dfv_assessment'"
        ),
        {"schema": json.dumps(QUESTION_SCHEMA), "objective": OBJECTIVE},
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = NULL, objective = :objective "
            "WHERE slug = 'dfv_assessment'"
        ),
        {"objective": OLD_OBJECTIVE},
    )
