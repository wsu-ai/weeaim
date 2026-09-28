"""fix key_benefits field type

Revision ID: 1441828407c6
Revises: 3bbecfd38941
Create Date: 2026-09-28 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '1441828407c6'
down_revision: Union[str, Sequence[str], None] = '3bbecfd38941'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _set_field_type(field_name: str, new_type: str) -> str:
    return f"""
        UPDATE wizard_stages
        SET question_schema = jsonb_set(
            question_schema,
            '{{fields}}',
            (
                SELECT jsonb_agg(
                    CASE WHEN field->>'name' = '{field_name}'
                         THEN jsonb_set(field, '{{type}}', '"{new_type}"')
                         ELSE field
                    END
                )
                FROM jsonb_array_elements(question_schema->'fields') AS field
            )
        )
        WHERE slug = 'value_proposition'
    """


def upgrade() -> None:
    op.execute(_set_field_type("key_benefits", "list"))


def downgrade() -> None:
    op.execute(_set_field_type("key_benefits", "text"))
