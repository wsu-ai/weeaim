"""add document chunk embedding column

Revision ID: ae9ae605b7cb
Revises: 1441828407c6
Create Date: 2026-09-28 18:13:15.878978

"""
from typing import Sequence, Union

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'ae9ae605b7cb'
down_revision: Union[str, Sequence[str], None] = '1441828407c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'document_chunks',
        sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=1024), nullable=True),
    )
    # autogenerate doesn't know about pgvector's index operator classes --
    # cosine distance is the standard choice for OpenAI embeddings.
    op.execute(
        "CREATE INDEX ix_document_chunks_embedding_hnsw ON document_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_hnsw")
    op.drop_column('document_chunks', 'embedding')
