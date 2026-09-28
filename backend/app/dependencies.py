from functools import lru_cache

from app.ai.base import AIProvider
from app.ai.openai_provider import OpenAIProvider
from app.config import settings
from app.storage.base import StorageAdapter
from app.storage.local import LocalFilesystemStorageAdapter


@lru_cache
def get_ai_provider() -> AIProvider:
    return OpenAIProvider(api_key=settings.openai_api_key, model=settings.openai_model)


@lru_cache
def get_storage_adapter() -> StorageAdapter:
    return LocalFilesystemStorageAdapter(base_dir=settings.upload_storage_dir)
