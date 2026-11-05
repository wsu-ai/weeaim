"""archive ventures in place (archived_at, archived_by); venture-action email codes

Revision ID: a8e4d1c7b350
Revises: f9a2c6d4e817
Create Date: 2026-10-16 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a8e4d1c7b350'
down_revision: Union[str, Sequence[str], None] = 'f9a2c6d4e817'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ventures already has forced row-level security; nothing changes there.
    op.add_column("ventures", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "ventures",
        sa.Column("archived_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_ventures_archived_at", "ventures", ["archived_at"])
    # Emailed codes can also confirm archiving/deleting a venture (accounts
    # without a password).
    op.drop_constraint("ck_email_codes_purpose", "email_codes", type_="check")
    op.create_check_constraint(
        "ck_email_codes_purpose",
        "email_codes",
        "purpose IN ('verify_email', 'reset_password', 'confirm_venture_action')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM email_codes WHERE purpose = 'confirm_venture_action'")
    op.drop_constraint("ck_email_codes_purpose", "email_codes", type_="check")
    op.create_check_constraint(
        "ck_email_codes_purpose", "email_codes", "purpose IN ('verify_email', 'reset_password')"
    )
    op.drop_index("ix_ventures_archived_at", table_name="ventures")
    op.drop_column("ventures", "archived_by")
    op.drop_column("ventures", "archived_at")
