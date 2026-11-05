"""insert the MVP stage as Stage 9; Business Model and later move up one

Revision ID: c8f4a2d6e391
Revises: b3e7c1f5a920
Create Date: 2026-10-13 10:05:00.000000

Responses reference stages by id, not number, so existing venture data is
unaffected by the renumbering.
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c8f4a2d6e391'
down_revision: Union[str, Sequence[str], None] = 'b3e7c1f5a920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Highest first: wizard_stages.number is unique.
MOVED_UP = ("decision_roadmap", "validation_plan", "business_model")

QUESTION_SCHEMA = {
    "fields": [
        {
            "name": "mvp_scope_changes",
            "label_en": "What would you add to or remove from this MVP?",
            "label_ko": "이 MVP에 무엇을 더하거나 빼고 싶나요?",
            "type": "text",
        },
        {
            "name": "build_plan",
            "label_en": "How will you build or deliver the first version, and with whom?",
            "label_ko": "첫 버전을 어떻게, 누구와 함께 만들거나 제공할 계획인가요?",
            "type": "text",
        },
        {
            "name": "test_plan",
            "label_en": "How will you put the MVP in front of your first users?",
            "label_ko": "MVP를 첫 사용자에게 어떻게 선보일 계획인가요?",
            "type": "text",
        },
    ]
}
OBJECTIVE = (
    "Turn the idea into a concrete minimum viable product or service: a "
    "product image, a sample web page, or a service description."
)


def upgrade() -> None:
    bind = op.get_bind()
    for slug in MOVED_UP:
        bind.execute(sa.text("UPDATE wizard_stages SET number = number + 1 WHERE slug = :slug"), {"slug": slug})
    bind.execute(
        sa.text(
            "INSERT INTO wizard_stages (id, number, slug, title_en, title_ko, objective, question_schema, "
            "created_at, updated_at) VALUES (gen_random_uuid(), 9, 'mvp', :title_en, :title_ko, :objective, "
            "CAST(:schema AS jsonb), now(), now()) ON CONFLICT (slug) DO NOTHING"
        ),
        {
            "title_en": "Minimum Viable Product (MVP/Service)",
            "title_ko": "최소 기능 제품(MVP/서비스)",
            "objective": OBJECTIVE,
            "schema": json.dumps(QUESTION_SCHEMA),
        },
    )


def downgrade() -> None:
    bind = op.get_bind()
    # Responses and revisions for the MVP stage go with it.
    stage = "(SELECT id FROM wizard_stages WHERE slug = 'mvp')"
    bind.execute(
        sa.text(
            "DELETE FROM wizard_response_revisions WHERE wizard_response_id IN "
            f"(SELECT id FROM wizard_responses WHERE wizard_stage_id = {stage})"
        )
    )
    bind.execute(sa.text(f"DELETE FROM wizard_responses WHERE wizard_stage_id = {stage}"))
    bind.execute(sa.text("DELETE FROM wizard_stages WHERE slug = 'mvp'"))
    for slug in reversed(MOVED_UP):
        bind.execute(sa.text("UPDATE wizard_stages SET number = number - 1 WHERE slug = :slug"), {"slug": slug})
