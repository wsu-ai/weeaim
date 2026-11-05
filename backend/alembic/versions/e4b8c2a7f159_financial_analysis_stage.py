"""insert the Financial Analysis stage as Stage 12; Decision and Roadmap moves to 13

Revision ID: e4b8c2a7f159
Revises: d9a3f6b1c824
Create Date: 2026-10-13 18:00:00.000000

Responses reference stages by id, not number, so existing venture data is
unaffected by the renumbering.
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e4b8c2a7f159'
down_revision: Union[str, Sequence[str], None] = 'd9a3f6b1c824'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "funding_plan",
            "label_en": "How will you fund the company until it breaks even?",
            "label_ko": "손익분기점에 이를 때까지 회사 자금을 어떻게 마련할 계획인가요?",
            "type": "text",
        },
        {
            "name": "biggest_cost_risk",
            "label_en": "Which cost worries you most, and why?",
            "label_ko": "가장 걱정되는 비용은 무엇이며, 그 이유는 무엇인가요?",
            "type": "text",
        },
        {
            "name": "financial_takeaways",
            "label_en": "What do these numbers tell you about the venture?",
            "label_ko": "이 수치들이 벤처에 대해 무엇을 말해 주나요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Project the venture's finances for 36 months from its operating costs and "
    "revenue drivers: burn rate, runway, break-even, NPV and IRR."
)


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE wizard_stages SET number = 13 WHERE slug = 'decision_roadmap'"))
    bind.execute(
        sa.text(
            "INSERT INTO wizard_stages (id, number, slug, title_en, title_ko, objective, question_schema, "
            "created_at, updated_at) VALUES (gen_random_uuid(), 12, 'financial_analysis', :title_en, "
            ":title_ko, :objective, CAST(:schema AS jsonb), now(), now()) ON CONFLICT (slug) DO NOTHING"
        ),
        {
            "title_en": "Financial Analysis",
            "title_ko": "재무 분석",
            "objective": OBJECTIVE,
            "schema": json.dumps(QUESTION_SCHEMA),
        },
    )


def downgrade() -> None:
    bind = op.get_bind()
    stage = "(SELECT id FROM wizard_stages WHERE slug = 'financial_analysis')"
    bind.execute(
        sa.text(
            "DELETE FROM wizard_response_revisions WHERE wizard_response_id IN "
            f"(SELECT id FROM wizard_responses WHERE wizard_stage_id = {stage})"
        )
    )
    bind.execute(sa.text(f"DELETE FROM wizard_responses WHERE wizard_stage_id = {stage}"))
    bind.execute(sa.text("DELETE FROM wizard_stages WHERE slug = 'financial_analysis'"))
    bind.execute(sa.text("UPDATE wizard_stages SET number = 12 WHERE slug = 'decision_roadmap'"))
