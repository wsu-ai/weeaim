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


settings = Settings()
