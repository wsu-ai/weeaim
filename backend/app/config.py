from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    database_url: str = ""
    app_database_url: str = ""
    app_db_user: str = ""
    app_db_password: str = ""
    service_database_url: str = ""
    service_db_user: str = ""
    service_db_password: str = ""
    redis_url: str = ""
    environment: str = "development"
    openai_api_key: str = ""
    openai_model: str = "gpt-6-astra"
    upload_storage_dir: str = "./storage/uploads"
    max_upload_size_bytes: int = 20_000_000


settings = Settings()
