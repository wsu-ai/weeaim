"""add users google_subject

Revision ID: b7c41e2f9a10
Revises: a00e08e85f5b
Create Date: 2026-10-01 18:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7c41e2f9a10'
down_revision: Union[str, Sequence[str], None] = 'a00e08e85f5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Links a user to their Google account on first Google sign-in. users is
    # not under RLS, and venture_app already has UPDATE on it (blanket grant
    # in the RLS migration), so no grant changes are needed.
    op.add_column('users', sa.Column('google_subject', sa.String(), nullable=True))
    op.create_index(
        op.f('ix_users_google_subject'), 'users', ['google_subject'], unique=True
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_users_google_subject'), table_name='users')
    op.drop_column('users', 'google_subject')
