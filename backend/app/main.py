from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import ventures, wizard

app = FastAPI(title="WEEAIM API")

if settings.environment != "production":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(ventures.router)
app.include_router(wizard.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
