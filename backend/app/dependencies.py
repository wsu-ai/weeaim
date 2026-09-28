from functools import lru_cache

from app.ai.base import AIProvider
from app.ai.openai_provider import OpenAIProvider
from app.config import settings


@lru_cache
def get_ai_provider() -> AIProvider:
    return OpenAIProvider(api_key=settings.openai_api_key, model=settings.openai_model)
