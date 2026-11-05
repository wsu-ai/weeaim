import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAIError
from sqlalchemy.exc import InterfaceError, OperationalError

from app.ai.errors import ai_problem
from app.config import settings
from app.routers import (
    admin,
    agents,
    auth,
    documents,
    external_sources,
    learning,
    personas,
    reports,
    tokens,
    ventures,
    wizard,
)
from app.sessions import SessionConfigError

logger = logging.getLogger(__name__)

app = FastAPI(title="WEEAIM API")


@app.exception_handler(OpenAIError)
async def openai_error_handler(request: Request, exc: OpenAIError) -> JSONResponse:
    # Covers auth/config errors, rate limits, and connection failures --
    # without this, any of these become a raw 500 with an internal stack
    # trace instead of a clean, expected response. Automatic retries are
    # still future work (docs/product-requirements.md's "100% valid
    # structured outputs, or handled retries" release gate) -- this makes
    # failures handled, not retried.
    logger.error("OpenAI API error on %s: %s", request.url.path, exc)
    # Out of credits, rate-limited or a rejected key get their own reason, so
    # the app can say what to do (e.g. "ask the administrator to add credits").
    problem = ai_problem(exc)
    return JSONResponse(
        status_code=503,
        content={"detail": problem or "The AI service is temporarily unavailable. Please try again shortly."},
    )


async def service_unavailable_handler(request: Request, exc: Exception) -> JSONResponse:
    # The database (or another backing service) can't be reached -- e.g.
    # Docker/Postgres isn't running. Without this, every request touching
    # the database becomes a bare 500 that looks like an application bug.
    logger.error(
        "Backing service unavailable on %s: %s: %s",
        request.url.path, type(exc).__name__, exc,
    )
    return JSONResponse(
        status_code=503,
        content={"detail": "A required service is temporarily unavailable. Please try again shortly."},
    )


# asyncpg raises plain ConnectionRefusedError/TimeoutError when Postgres is
# down at connect time; SQLAlchemy raises these when a connection drops.
for _exc_class in (ConnectionError, TimeoutError, OperationalError, InterfaceError):
    app.add_exception_handler(_exc_class, service_unavailable_handler)


@app.exception_handler(SessionConfigError)
async def session_config_error_handler(request: Request, exc: SessionConfigError) -> JSONResponse:
    logger.error("Session configuration error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=503, content={"detail": "Sign-in is not configured on this server."}
    )


if settings.environment != "production":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        # The session cookie is sent cross-origin (port 3000 -> 8000).
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(ventures.router)
app.include_router(wizard.router)
app.include_router(personas.router)
app.include_router(agents.router)
app.include_router(tokens.router)
app.include_router(learning.router)
app.include_router(external_sources.router)
app.include_router(documents.router)
app.include_router(reports.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
