import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.embedding_provider import EmbeddingProvider
from app.auth import AuthContext, get_auth_context
from app.config import settings
from app.db import get_session
from app.dependencies import get_embedding_provider, get_storage_adapter
from app.documents.extraction import extract_document
from app.documents.schemas import DocumentEmbedResult, DocumentProcessResult, DocumentRead
from app.documents.validation import DocumentValidationError, validate_upload
from app.models import AuditLog, Document, DocumentChunk
from app.routers.ventures import _load_venture
from app.storage.base import StorageAdapter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ventures", tags=["documents"])


async def _load_document(
    session: AsyncSession, venture_id: uuid.UUID, document_id: uuid.UUID
) -> Document:
    document = (
        await session.execute(
            select(Document).where(
                Document.id == document_id,
                Document.venture_id == venture_id,
                Document.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.post("/{venture_id}/documents", response_model=DocumentRead, status_code=201)
async def upload_document(
    venture_id: uuid.UUID,
    file: UploadFile,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    storage: StorageAdapter = Depends(get_storage_adapter),
) -> Document:
    venture = await _load_venture(session, auth, venture_id)

    content = await file.read()
    try:
        ext = validate_upload(
            file.filename or "",
            file.content_type or "",
            content,
            settings.max_upload_size_bytes,
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    storage_key = f"{auth.organization_id}/{venture.id}/{uuid.uuid4()}{ext}"
    await storage.save(storage_key, content)

    document = Document(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        uploaded_by=auth.user_id,
        original_filename=file.filename or "unnamed",
        storage_key=storage_key,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
    )
    session.add(document)
    await session.flush()

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="document.upload",
            resource_type="document",
            resource_id=document.id,
        )
    )
    await session.commit()
    return document


@router.get("/{venture_id}/documents", response_model=list[DocumentRead])
async def list_documents(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[Document]:
    venture = await _load_venture(session, auth, venture_id)
    documents = (
        await session.execute(
            select(Document).where(
                Document.venture_id == venture.id, Document.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    return list(documents)


@router.delete("/{venture_id}/documents/{document_id}", status_code=204)
async def delete_document(
    venture_id: uuid.UUID,
    document_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    storage: StorageAdapter = Depends(get_storage_adapter),
) -> None:
    venture = await _load_venture(session, auth, venture_id)
    document = await _load_document(session, venture.id, document_id)

    document.deleted_at = datetime.now(UTC)
    document.processing_status = "deleted"
    await storage.delete(document.storage_key)

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="document.delete",
            resource_type="document",
            resource_id=document.id,
        )
    )
    await session.commit()


@router.post(
    "/{venture_id}/documents/{document_id}/process", response_model=DocumentProcessResult
)
async def process_document(
    venture_id: uuid.UUID,
    document_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    storage: StorageAdapter = Depends(get_storage_adapter),
) -> DocumentProcessResult:
    venture = await _load_venture(session, auth, venture_id)
    document = await _load_document(session, venture.id, document_id)

    ext = document.storage_key[document.storage_key.rfind(".") :]
    content = await storage.read(document.storage_key)

    try:
        chunks = extract_document(ext, content)
    except Exception:
        logger.exception("Failed to extract document %s", document.id)
        document.processing_status = "failed"
        session.add(
            AuditLog(
                organization_id=auth.organization_id,
                actor_user_id=auth.user_id,
                action="document.process",
                resource_type="document",
                resource_id=document.id,
            )
        )
        await session.commit()
        return DocumentProcessResult(document=DocumentRead.model_validate(document), chunk_count=0)

    await session.execute(
        DocumentChunk.__table__.delete().where(DocumentChunk.document_id == document.id)
    )

    for index, chunk in enumerate(chunks):
        session.add(
            DocumentChunk(
                organization_id=auth.organization_id,
                venture_id=venture.id,
                document_id=document.id,
                chunk_index=index,
                content=chunk.content,
                page_number=chunk.page_number,
                section_heading=chunk.section_heading,
                chunk_metadata=chunk.metadata,
            )
        )

    document.processing_status = "processed"
    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="document.process",
            resource_type="document",
            resource_id=document.id,
        )
    )
    await session.commit()

    return DocumentProcessResult(
        document=DocumentRead.model_validate(document), chunk_count=len(chunks)
    )


@router.post(
    "/{venture_id}/documents/{document_id}/embed", response_model=DocumentEmbedResult
)
async def embed_document(
    venture_id: uuid.UUID,
    document_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    embedder: EmbeddingProvider = Depends(get_embedding_provider),
) -> DocumentEmbedResult:
    venture = await _load_venture(session, auth, venture_id)
    document = await _load_document(session, venture.id, document_id)

    unembedded = (
        await session.execute(
            select(DocumentChunk).where(
                DocumentChunk.document_id == document.id,
                DocumentChunk.embedding.is_(None),
            )
        )
    ).scalars().all()

    if unembedded:
        vectors = await embedder.embed([chunk.content for chunk in unembedded])
        for chunk, vector in zip(unembedded, vectors, strict=True):
            chunk.embedding = vector

        session.add(
            AuditLog(
                organization_id=auth.organization_id,
                actor_user_id=auth.user_id,
                action="document.embed",
                resource_type="document",
                resource_id=document.id,
            )
        )
        await session.commit()

    return DocumentEmbedResult(embedded_count=len(unembedded))
