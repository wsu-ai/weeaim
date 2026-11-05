"""insert Personas Validation as Stage 7; Stages 7-14 move up one

Revision ID: b4d7f2a9c815
Revises: a1c5e8f3b602
Create Date: 2026-10-14 09:05:00.000000

Responses reference stages by id, not number, so existing venture data is
unaffected by the renumbering.
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b4d7f2a9c815'
down_revision: Union[str, Sequence[str], None] = 'a1c5e8f3b602'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Highest first: wizard_stages.number is unique.
MOVED_UP = (
    "decision_roadmap", "marketing_plan", "financial_analysis", "validation_plan",
    "business_model", "mvp", "dfv_assessment", "competitive_position",
)

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "validation_takeaways",
            "label_en": "What did the persona conversations confirm or change about your idea?",
            "label_ko": "페르소나와의 대화로 아이디어에 대해 무엇이 확인되거나 바뀌었나요?",
            "type": "text",
        },
        {
            "name": "next_real_test",
            "label_en": "Which assumption will you now test with real customers?",
            "label_ko": "이제 실제 고객과 어떤 가정을 검증할 계획인가요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Define the target personas and talk with AI personas to probe the idea's "
    "feasibility and viability before testing with real customers."
)


def upgrade() -> None:
    bind = op.get_bind()
    for slug in MOVED_UP:
        bind.execute(sa.text("UPDATE wizard_stages SET number = number + 1 WHERE slug = :slug"), {"slug": slug})
    bind.execute(
        sa.text(
            "INSERT INTO wizard_stages (id, number, slug, title_en, title_ko, objective, question_schema, "
            "created_at, updated_at) VALUES (gen_random_uuid(), 7, 'persona_validation', :title_en, :title_ko, "
            ":objective, CAST(:schema AS jsonb), now(), now()) ON CONFLICT (slug) DO NOTHING"
        ),
        {
            "title_en": "Personas Validation",
            "title_ko": "페르소나 검증",
            "objective": OBJECTIVE,
            "schema": json.dumps(QUESTION_SCHEMA),
        },
    )


def downgrade() -> None:
    bind = op.get_bind()
    stage = "(SELECT id FROM wizard_stages WHERE slug = 'persona_validation')"
    bind.execute(
        sa.text(
            "DELETE FROM wizard_response_revisions WHERE wizard_response_id IN "
            f"(SELECT id FROM wizard_responses WHERE wizard_stage_id = {stage})"
        )
    )
    bind.execute(sa.text(f"DELETE FROM wizard_responses WHERE wizard_stage_id = {stage}"))
    bind.execute(sa.text("DELETE FROM wizard_stages WHERE slug = 'persona_validation'"))
    for slug in reversed(MOVED_UP):
        bind.execute(sa.text("UPDATE wizard_stages SET number = number - 1 WHERE slug = :slug"), {"slug": slug})
