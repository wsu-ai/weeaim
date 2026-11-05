"""Stage 9 (Minimum Viable Product / Service): context, image and stored result.

The concept is synthesized from stages 1-8 (never locked: missing stages
count as missing evidence) and shown according to the kind of offering:

    physical_product -> a generated concept image (stored in venture_assets)
    online_service   -> a sample landing page, rendered by the app's own
                        component from structured content (no model-written HTML)
    offline_service  -> a service description

The founder can override the AI's choice of offering type (MvpAnswers).
"""

import re
import time
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import MvpConcept
from app.auth import AuthContext
from app.models import AIRun, Venture, VentureAsset, WizardResponse
from app.models.asset import MAX_ASSET_BYTES
from app.wizard.competitive_position import founder_and_research_context
from app.wizard.dfv_assessment import STAGE_LABELS as STAGE_1_TO_7_LABELS
from app.wizard.dfv_assessment import research_data_with_assessment

STAGE_LABELS = {
    **STAGE_1_TO_7_LABELS,
    "dfv_assessment": "Stage 9 - DFV assessment",
}
OFFERING_TYPES = ("physical_product", "online_service", "offline_service")
OFFERING_LABELS = {
    "physical_product": "a physical product",
    "online_service": "an online service",
    "offline_service": "an offline (in-person) service",
}
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_COLORS = {"primary_color": "#1d4ed8", "accent_color": "#f59e0b"}
# Lengths the mockup layout is designed for; longer model text is cut.
MOCKUP_LIMITS = {"brand_name": 40, "hero_headline": 90, "hero_subheadline": 200, "cta_label": 30}
IMAGE_PROMPT = (
    "Photorealistic product concept render of the following product, on a plain "
    "light studio background, three-quarter view, soft lighting. No text, no "
    "logos, no brand names, no people's faces. Product: {description}"
)


def founder_offering_type(responses: dict[str, WizardResponse]) -> str | None:
    response = responses.get("mvp")
    value = ((response.answers or {}) if response else {}).get("offering_type")
    return value if value in OFFERING_TYPES else None


def mvp_context(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """The founder's stage 1-8 answers, then the earlier research as untrusted data."""
    override = founder_offering_type(responses)
    extra = (
        [f"The founder says this offering is {OFFERING_LABELS[override]}: use offering_type {override!r}."]
        if override
        else []
    )
    return founder_and_research_context(
        venture, responses, STAGE_LABELS, research_data_with_assessment(responses), extra
    )


def based_on(responses: dict[str, WizardResponse]) -> str | None:
    """When the stage 1-8 answers or research this concept used last changed."""
    times = [r.updated_at for slug, r in responses.items() if slug in STAGE_LABELS and r.updated_at]
    return max(times).isoformat() if times else None


def _clean_mockup(mockup: dict) -> dict:
    """Valid #rrggbb colours (else safe defaults) and lengths the layout fits."""
    cleaned = dict(mockup)
    for field, default in DEFAULT_COLORS.items():
        if not HEX_COLOR.match(str(cleaned.get(field) or "")):
            cleaned[field] = default
    for field, limit in MOCKUP_LIMITS.items():
        text = str(cleaned.get(field) or "")
        cleaned[field] = text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
    return cleaned


def image_kind(data: bytes) -> str | None:
    """The content type from the file's own signature; None if not an allowed image."""
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    return None


async def generate_image(
    session: AsyncSession,
    provider: AIProvider,
    auth: AuthContext,
    venture: Venture,
    concept: MvpConcept,
) -> dict:
    """Generates and stores the concept image for a physical product.

    Logged as its own ai_runs row (without the image bytes). A failure never
    fails the stage: the concept is kept and the panel offers a retry.
    """
    assert concept.physical_product is not None
    prompt = IMAGE_PROMPT.format(description=concept.physical_product.image_prompt)
    run = AIRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        operation="mvp_image",
        provider=type(provider).__name__,
        model=getattr(provider, "image_model", "unknown"),
        input_payload={"prompt": prompt},
        status="pending",
    )
    started = time.monotonic()
    try:
        data = await provider.generate_product_image(prompt)
        content_type = image_kind(data)
        if content_type is None:
            raise ValueError("Image provider returned an unsupported file type")
        if len(data) > MAX_ASSET_BYTES:
            raise ValueError(f"Image is too large ({len(data)} bytes)")
    except Exception as exc:  # noqa: BLE001 -- any failure: keep the concept
        run.status = "failed"
        run.error_message = f"{type(exc).__name__}: {exc}"[:2000]
        run.latency_ms = int((time.monotonic() - started) * 1000)
        session.add(run)
        return {"image": None, "image_failed": True}

    asset = VentureAsset(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        kind="mvp_image",
        content_type=content_type,
        data=data,
        byte_size=len(data),
    )
    session.add(asset)
    await session.flush()
    run.status = "succeeded"
    run.output_payload = {"asset_id": str(asset.id), "content_type": content_type, "byte_size": len(data)}
    run.latency_ms = int((time.monotonic() - started) * 1000)
    session.add(run)
    return {"image": {"asset_id": str(asset.id), "content_type": content_type}, "image_failed": False}


def mvp_payload(
    concept: MvpConcept,
    language: str,
    researched_at: datetime,
    based_on_at: str | None,
    founder_type: str | None,
    image: dict | None = None,
) -> dict:
    payload = concept.model_dump()
    if payload.get("website_mockup"):
        payload["website_mockup"] = _clean_mockup(payload["website_mockup"])
    return {
        "kind": "mvp",
        **payload,
        "offering_type_source": "founder" if founder_type == concept.offering_type else "ai",
        "image": (image or {}).get("image"),
        "image_failed": bool((image or {}).get("image_failed")),
        # No web search in this stage: it builds on the evidence already gathered.
        "sources": [],
        "researched_at": researched_at.isoformat(),
        "based_on": based_on_at,
        "language": language,
    }
