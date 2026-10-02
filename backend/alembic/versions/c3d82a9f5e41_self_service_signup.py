"""self-service sign-up: password accounts, consents, email codes

Revision ID: c3d82a9f5e41
Revises: b7c41e2f9a10
Create Date: 2026-10-02 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c3d82a9f5e41'
down_revision: Union[str, Sequence[str], None] = 'b7c41e2f9a10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users: password accounts and registration details. Existing users
    # (invited / Google) keep working: account_status defaults to 'active'.
    op.add_column('users', sa.Column('password_hash', sa.String(), nullable=True))
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'users',
        sa.Column('account_status', sa.String(), server_default=sa.text("'active'"), nullable=False),
    )
    op.add_column('users', sa.Column('affiliation', sa.String(), nullable=True))
    op.add_column('users', sa.Column('affiliation_name', sa.String(), nullable=True))
    op.add_column('users', sa.Column('department', sa.String(), nullable=True))
    op.add_column(
        'users',
        sa.Column('preferred_language', sa.String(), server_default=sa.text("'en'"), nullable=False),
    )
    op.add_column('users', sa.Column('access_reason', sa.Text(), nullable=True))
    op.add_column(
        'users',
        sa.Column('failed_login_attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
    )
    op.add_column('users', sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        'ck_users_account_status', 'users',
        "account_status IN ('active', 'pending', 'rejected', 'disabled')",
    )
    op.create_check_constraint(
        'ck_users_affiliation', 'users',
        "affiliation IS NULL OR affiliation IN ('woosong_student', "
        "'woosong_faculty_staff', 'woosong_alumni', 'external_founder', 'other')",
    )
    op.create_check_constraint(
        'ck_users_preferred_language', 'users', "preferred_language IN ('en', 'ko')"
    )

    # Neither table is organization-owned (pending users have no
    # organization yet); both hang off users, which is not under RLS.
    op.create_table(
        'user_consents',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('consent_type', sa.String(), nullable=False),
        sa.Column('policy_version', sa.String(), nullable=False),
        sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "consent_type IN ('terms', 'privacy', 'ai_processing')", name='ck_user_consents_type'
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_consents_user_id'), 'user_consents', ['user_id'], unique=False)

    op.create_table(
        'email_codes',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('purpose', sa.String(), nullable=False),
        sa.Column('code_hash', sa.String(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "purpose IN ('verify_email', 'reset_password')", name='ck_email_codes_purpose'
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_email_codes_user_id'), 'email_codes', ['user_id'], unique=False)

    # Default privileges from the RLS migration already cover new tables;
    # granted explicitly too, as wizard_response_revisions does.
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON user_consents, email_codes "
        "TO venture_app, venture_service"
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_email_codes_user_id'), table_name='email_codes')
    op.drop_table('email_codes')
    op.drop_index(op.f('ix_user_consents_user_id'), table_name='user_consents')
    op.drop_table('user_consents')
    op.drop_constraint('ck_users_preferred_language', 'users', type_='check')
    op.drop_constraint('ck_users_affiliation', 'users', type_='check')
    op.drop_constraint('ck_users_account_status', 'users', type_='check')
    for column in (
        'locked_until', 'failed_login_attempts', 'access_reason', 'preferred_language',
        'department', 'affiliation_name', 'affiliation', 'account_status',
        'email_verified_at', 'password_hash',
    ):
        op.drop_column('users', column)
