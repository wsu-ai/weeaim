"""seed wizard stages

Revision ID: 3bbecfd38941
Revises: ed93609ca675
Create Date: 2026-09-28 17:01:52.428013

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, insert

# revision identifiers, used by Alembic.
revision: str = '3bbecfd38941'
down_revision: Union[str, Sequence[str], None] = 'ed93609ca675'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

wizard_stages_table = sa.table(
    "wizard_stages",
    sa.column("number", sa.Integer),
    sa.column("slug", sa.String),
    sa.column("title_en", sa.String),
    sa.column("title_ko", sa.String),
    sa.column("objective", sa.String),
    sa.column("question_schema", JSONB),
)


def _fields(*names_labels: tuple[str, str, str]) -> dict:
    return {
        "fields": [
            {"name": name, "label_en": label_en, "label_ko": label_ko, "type": "text"}
            for name, label_en, label_ko in names_labels
        ]
    }


STAGES = [
    {
        "number": 1,
        "slug": "idea_discovery",
        "title_en": "Idea Discovery",
        "title_ko": "아이디어 발굴",
        "objective": "Capture the founder's free-text business idea.",
        "question_schema": sa.null(),
    },
    {
        "number": 2,
        "slug": "problem_definition",
        "title_en": "Problem Definition",
        "title_ko": "문제 정의",
        "objective": "Define the customer problem this venture addresses.",
        "question_schema": _fields(
            ("problem_statement", "What problem are you solving?", "어떤 문제를 해결하시나요?"),
            (
                "evidence_for_problem",
                "What evidence do you have that this problem exists?",
                "이 문제가 존재한다는 근거는 무엇인가요?",
            ),
            (
                "who_experiences_it",
                "Who experiences this problem?",
                "이 문제를 겪는 사람은 누구인가요?",
            ),
            (
                "frequency_severity",
                "How often, and how severely, do they experience it?",
                "얼마나 자주, 얼마나 심각하게 겪나요?",
            ),
        ),
    },
    {
        "number": 3,
        "slug": "customer_definition",
        "title_en": "Customer Definition",
        "title_ko": "고객 정의",
        "objective": "Define the primary target customer.",
        "question_schema": _fields(
            (
                "primary_customer_segment",
                "Who is your primary customer segment?",
                "주요 고객 세그먼트는 누구인가요?",
            ),
            (
                "customer_characteristics",
                "What characterizes this segment?",
                "이 세그먼트의 특징은 무엇인가요?",
            ),
            (
                "buying_trigger",
                "What triggers them to look for a solution?",
                "무엇이 이들로 하여금 해결책을 찾게 만드나요?",
            ),
        ),
    },
    {
        "number": 4,
        "slug": "existing_alternatives",
        "title_en": "Existing Alternatives",
        "title_ko": "기존 대안",
        "objective": "Not yet implemented in the vertical slice.",
        "question_schema": sa.null(),
    },
    {
        "number": 5,
        "slug": "value_proposition",
        "title_en": "Value Proposition",
        "title_ko": "가치 제안",
        "objective": "Define the venture's value proposition.",
        "question_schema": _fields(
            (
                "value_proposition_statement",
                "State your value proposition in one or two sentences.",
                "가치 제안을 한두 문장으로 서술하세요.",
            ),
            (
                "key_benefits",
                "What are the key benefits to the customer?",
                "고객에게 제공하는 핵심 이점은 무엇인가요?",
            ),
            (
                "differentiation",
                "How is this different from existing alternatives?",
                "기존 대안과 어떻게 다른가요?",
            ),
        ),
    },
    {
        "number": 6,
        "slug": "market_evidence",
        "title_en": "Market Evidence",
        "title_ko": "시장 근거",
        "objective": "Not yet implemented in the vertical slice.",
        "question_schema": sa.null(),
    },
    {
        "number": 7,
        "slug": "competitive_position",
        "title_en": "Competitive Position",
        "title_ko": "경쟁 포지션",
        "objective": "Not yet implemented in the vertical slice.",
        "question_schema": sa.null(),
    },
    {
        "number": 8,
        "slug": "dfv_assessment",
        "title_en": "Desirability, Feasibility, Viability Assessment",
        "title_ko": "desirability·feasibility·viability(DFV) 평가",
        "objective": "Not yet implemented in the vertical slice.",
        "question_schema": sa.null(),
    },
    {
        "number": 9,
        "slug": "business_model",
        "title_en": "Business Model",
        "title_ko": "비즈니스 모델",
        "objective": "Not yet implemented in the vertical slice.",
        "question_schema": sa.null(),
    },
    {
        "number": 10,
        "slug": "validation_plan",
        "title_en": "Validation Plan",
        "title_ko": "검증 계획",
        "objective": "Not yet implemented in the vertical slice.",
        "question_schema": sa.null(),
    },
    {
        "number": 11,
        "slug": "decision_roadmap",
        "title_en": "Decision and Roadmap",
        "title_ko": "결정 및 로드맵",
        "objective": "Not yet implemented in the vertical slice.",
        "question_schema": sa.null(),
    },
]


def upgrade() -> None:
    stmt = insert(wizard_stages_table).values(STAGES)
    stmt = stmt.on_conflict_do_nothing(index_elements=["slug"])
    op.execute(stmt)


def downgrade() -> None:
    op.execute(
        wizard_stages_table.delete().where(
            wizard_stages_table.c.slug.in_([s["slug"] for s in STAGES])
        )
    )
