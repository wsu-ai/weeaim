"""user default location

Revision ID: d7f3b2e9a145
Revises: c4e8a1b7f390
Create Date: 2026-10-12 18:00:00.000000

The user's default country and metropolitan city, used to pre-fill Stage 6
market sizing.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd7f3b2e9a145'
down_revision: Union[str, Sequence[str], None] = 'c4e8a1b7f390'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('default_country', sa.String(length=100), nullable=True))
    op.add_column('users', sa.Column('default_metro_city', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'default_metro_city')
    op.drop_column('users', 'default_country')
