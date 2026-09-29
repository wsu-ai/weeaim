"""revoke audit log update delete

Revision ID: 2d42a344a0f7
Revises: ae9ae605b7cb
Create Date: 2026-09-29 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '2d42a344a0f7'
down_revision: Union[str, Sequence[str], None] = 'ae9ae605b7cb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Immutable access audit logs: the app inserts and reads, never
    # updates or deletes. The Phase 4b RLS migration's blanket GRANT ...
    # ON ALL TABLES gave both app roles UPDATE/DELETE here too, which this
    # corrects.
    op.execute("REVOKE UPDATE, DELETE ON audit_logs FROM venture_app, venture_service")


def downgrade() -> None:
    op.execute("GRANT UPDATE, DELETE ON audit_logs TO venture_app, venture_service")
