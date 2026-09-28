import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    venture_id: uuid.UUID
    original_filename: str
    mime_type: str
    size_bytes: int
    classification: str
    processing_status: str
    created_at: datetime


class DocumentProcessResult(BaseModel):
    document: DocumentRead
    chunk_count: int


class DocumentEmbedResult(BaseModel):
    embedded_count: int


class RetrieveRequest(BaseModel):
    query: str
    limit: int = 10


class RetrievedChunk(BaseModel):
    citation_id: uuid.UUID
    document_id: uuid.UUID
    content: str
    page_number: int | None
    section_heading: str | None
    score: float
