"""market evidence: founder location fields

Revision ID: c4e8a1b7f390
Revises: b9d2f6a4c731
Create Date: 2026-10-12 14:00:00.000000

Stage 6 sizes the market for three geographies (global, the founder's
country, the founder's metropolitan city), so it asks where the founder is.
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4e8a1b7f390'
down_revision: Union[str, Sequence[str], None] = 'b9d2f6a4c731'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCATION_FIELDS = [
    {"name": "user_country", "label_en": "Your country", "label_ko": "거주 국가", "type": "short"},
    {
        "name": "user_metro_city",
        "label_en": "Your metropolitan city",
        "label_ko": "거주 대도시",
        "type": "short",
    },
]
OTHER_FIELDS = [
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


def _set(fields: list[dict]) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE wizard_stages SET question_schema = CAST(:schema AS jsonb) "
            "WHERE slug = 'market_evidence'"
        ),
        {"schema": json.dumps({"fields": fields})},
    )


def upgrade() -> None:
    _set(LOCATION_FIELDS + OTHER_FIELDS)


def downgrade() -> None:
    _set(OTHER_FIELDS)
