from functools import lru_cache

from app.ai.base import AIProvider
from app.ai.embedding_provider import EmbeddingProvider, OpenAIEmbeddingProvider
from app.ai.openai_provider import OpenAIProvider
from app.config import settings
from app.google_auth import GoogleTokenVerifier, google_key_resolver
from app.mailer import ConsoleEmailSender, EmailSender, SmtpEmailSender
from app.storage.base import StorageAdapter
from app.storage.local import LocalFilesystemStorageAdapter


@lru_cache
def get_ai_provider() -> AIProvider:
    return OpenAIProvider(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        web_search_domains=settings.web_search_domains,
    )


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    return OpenAIEmbeddingProvider(
        api_key=settings.openai_api_key,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
        batch_size=settings.embedding_batch_size,
    )


@lru_cache
def get_storage_adapter() -> StorageAdapter:
    return LocalFilesystemStorageAdapter(base_dir=settings.upload_storage_dir)


@lru_cache
def get_google_verifier() -> GoogleTokenVerifier:
    return GoogleTokenVerifier(
        client_id=settings.google_client_id, key_resolver=google_key_resolver()
    )


@lru_cache
def get_email_sender() -> EmailSender:
    if settings.email_backend == "smtp":
        return SmtpEmailSender(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
            sender=settings.email_from,
        )
    return ConsoleEmailSender()
