"""sign-up review fields on users

Revision ID: d5e17b3c8f02
Revises: c3d82a9f5e41
Create Date: 2026-10-02 16:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd5e17b3c8f02'
down_revision: Union[str, Sequence[str], None] = 'c3d82a9f5e41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Records who approved/rejected a sign-up. Rejections have no
    # organization, so they can't live in the org-scoped (RLS) audit_logs.
    op.add_column('users', sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'users', sa.Column('reviewed_by_user_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column('users', sa.Column('review_note', sa.Text(), nullable=True))
    op.create_foreign_key(
        'users_reviewed_by_user_id_fkey', 'users', 'users',
        ['reviewed_by_user_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('users_reviewed_by_user_id_fkey', 'users', type_='foreignkey')
    op.drop_column('users', 'review_note')
    op.drop_column('users', 'reviewed_by_user_id')
    op.drop_column('users', 'reviewed_at')
