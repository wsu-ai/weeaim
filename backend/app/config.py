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
    embedding_model: str = "text-embedding-3-large"
    embedding_dimensions: int = 1024
    embedding_batch_size: int = 100
    retrieval_max_chunks: int = 20
    # Sign in with Google (see docs/google-sign-in.md). The client ID is
    # public by design; SESSION_SECRET must stay server-side.
    google_client_id: str = ""
    session_secret: str = ""
    session_ttl_minutes: int = 480
    # None = Secure cookies in production only (local dev runs over http).
    session_cookie_secure: bool | None = None

    # Self-service sign-up (see docs/sign-up-and-approval.md).
    # "console" logs emails (codes included) to the backend console -- for
    # local development only. "smtp" sends real email.
    email_backend: str = "console"
    email_from: str = "WEEAIM <no-reply@localhost>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    # Optional: where to notify an administrator about new sign-ups.
    signup_notify_email: str = ""
    email_code_ttl_minutes: int = 15
    email_code_max_attempts: int = 5
    email_code_resend_seconds: int = 60
    login_max_failed_attempts: int = 5
    login_lockout_minutes: int = 15
    # Stage 1 idea research uses OpenAI's web search. Comma-separated domains
    # restrict where it may look (e.g. "crunchbase.com,kipo.go.kr"); empty
    # means the whole web. See docs/security-model.md.
    web_search_allowed_domains: str = ""

    @property
    def web_search_domains(self) -> list[str]:
        return [d.strip() for d in self.web_search_allowed_domains.split(",") if d.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def dev_login_enabled(self) -> bool:
        return not self.is_production


settings = Settings()
