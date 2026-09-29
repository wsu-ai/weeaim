"""audit log fks set null on delete

Revision ID: a00e08e85f5b
Revises: a93da6f9d675
Create Date: 2026-09-29 10:09:30.912321

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a00e08e85f5b'
down_revision: Union[str, Sequence[str], None] = 'a93da6f9d675'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Immutable audit_logs rows must survive deleting the organization/user
    # they reference -- otherwise a tenant could never be deleted once it
    # had any audit history (the app can no longer delete/update audit_logs
    # rows itself, per the previous migration).
    op.drop_constraint('audit_logs_organization_id_fkey', 'audit_logs', type_='foreignkey')
    op.drop_constraint('audit_logs_actor_user_id_fkey', 'audit_logs', type_='foreignkey')
    op.create_foreign_key(
        'audit_logs_organization_id_fkey',
        'audit_logs', 'organizations', ['organization_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'audit_logs_actor_user_id_fkey',
        'audit_logs', 'users', ['actor_user_id'], ['id'],
        ondelete='SET NULL',
    )
    # NOTE: autogenerate also proposed dropping ix_document_chunks_embedding_hnsw
    # here -- a false positive (see the Phase 9c/wizard_response_revisions
    # migrations for the same note). Deliberately omitted.


def downgrade() -> None:
    op.drop_constraint('audit_logs_organization_id_fkey', 'audit_logs', type_='foreignkey')
    op.drop_constraint('audit_logs_actor_user_id_fkey', 'audit_logs', type_='foreignkey')
    op.create_foreign_key(
        'audit_logs_organization_id_fkey',
        'audit_logs', 'organizations', ['organization_id'], ['id'],
    )
    op.create_foreign_key(
        'audit_logs_actor_user_id_fkey',
        'audit_logs', 'users', ['actor_user_id'], ['id'],
    )
