"""insert the Marketing Plan stage as Stage 13; Decision and Roadmap moves to 14

Revision ID: f6c1d9e3a274
Revises: e4b8c2a7f159
Create Date: 2026-10-13 22:00:00.000000

Responses reference stages by id, not number, so existing venture data is
unaffected by the renumbering.
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f6c1d9e3a274'
down_revision: Union[str, Sequence[str], None] = 'e4b8c2a7f159'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "first_channel",
            "label_en": "Which channel will you start with, and why?",
            "label_ko": "어떤 채널부터 시작할 것이며, 그 이유는 무엇인가요?",
            "type": "text",
        },
        {
            "name": "marketing_budget",
            "label_en": "What monthly marketing budget can you commit?",
            "label_ko": "매월 마케팅에 얼마를 쓸 수 있나요?",
            "type": "text",
        },
        {
            "name": "success_90_days",
            "label_en": "How will you measure marketing success in the first 90 days?",
            "label_ko": "첫 90일 동안 마케팅 성과를 어떻게 측정할 계획인가요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Outline a competitive, differentiated marketing plan for the target market, "
    "and create a presentation deck of the venture."
)


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE wizard_stages SET number = 14 WHERE slug = 'decision_roadmap'"))
    bind.execute(
        sa.text(
            "INSERT INTO wizard_stages (id, number, slug, title_en, title_ko, objective, question_schema, "
            "created_at, updated_at) VALUES (gen_random_uuid(), 13, 'marketing_plan', :title_en, "
            ":title_ko, :objective, CAST(:schema AS jsonb), now(), now()) ON CONFLICT (slug) DO NOTHING"
        ),
        {
            "title_en": "Marketing Plan",
            "title_ko": "마케팅 계획",
            "objective": OBJECTIVE,
            "schema": json.dumps(QUESTION_SCHEMA),
        },
    )


def downgrade() -> None:
    bind = op.get_bind()
    stage = "(SELECT id FROM wizard_stages WHERE slug = 'marketing_plan')"
    bind.execute(
        sa.text(
            "DELETE FROM wizard_response_revisions WHERE wizard_response_id IN "
            f"(SELECT id FROM wizard_responses WHERE wizard_stage_id = {stage})"
        )
    )
    bind.execute(sa.text(f"DELETE FROM wizard_responses WHERE wizard_stage_id = {stage}"))
    bind.execute(sa.text("DELETE FROM wizard_stages WHERE slug = 'marketing_plan'"))
    bind.execute(sa.text("UPDATE wizard_stages SET number = 13 WHERE slug = 'decision_roadmap'"))
