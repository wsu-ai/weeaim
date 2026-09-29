import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAIError

from app.config import settings
from app.routers import documents, reports, ventures, wizard

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
    return JSONResponse(
        status_code=503,
        content={"detail": "The AI service is temporarily unavailable. Please try again shortly."},
    )

if settings.environment != "production":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(ventures.router)
app.include_router(wizard.router)
app.include_router(documents.router)
app.include_router(reports.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
