"""Stage 7 persona chats: talk with an AI persona that role-plays one of the
venture's target personas. Messages are saved per persona (persona_messages,
tenant-isolated by RLS); every request runs in the caller's organization scope.
"""

import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from openai import OpenAIError
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider
from app.models import AIRun, AuditLog, PersonaMessage, Venture
from app.models.persona import MAX_MESSAGE_CHARS
from app.routers.ventures import _load_venture
from app.routers.wizard import _responses_by_slug
from app.tokens import metered
from app.wizard.personas import (
    cached_market_profile,
    HISTORY_FOR_AI,
    MAX_MESSAGES,
    criteria_key,
    market_evidence_text,
    market_profile_payload,
    persona_profile_text,
    saved_personas,
    venture_brief,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ventures", tags=["personas"])


class PersonaMessageRead(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime


class PersonaMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    language: Literal["en", "ko"] = "en"


class MarketProfileRequest(BaseModel):
    language: Literal["en", "ko"] = "en"
    # Research again even if the criteria haven't changed.
    refresh: bool = False


class PersonaExchange(BaseModel):
    founder: PersonaMessageRead
    persona: PersonaMessageRead


def _read(message: PersonaMessage) -> PersonaMessageRead:
    return PersonaMessageRead(id=message.id, role=message.role, content=message.content, created_at=message.created_at)


async def _venture_and_persona(
    session: AsyncSession, auth: AuthContext, venture_id: uuid.UUID, persona_id: str
) -> tuple[Venture, dict, dict]:
    venture = await _load_venture(session, auth, venture_id)
    responses = await _responses_by_slug(session, venture.id)
    persona = next((p for p in saved_personas(responses) if p["id"] == persona_id), None)
    if persona is None:
        raise HTTPException(status_code=404, detail="Persona not found")
    return venture, persona, responses


async def _messages(session: AsyncSession, venture_id: uuid.UUID, persona_id: str) -> list[PersonaMessage]:
    return list(
        (
            await session.execute(
                select(PersonaMessage)
                .where(PersonaMessage.venture_id == venture_id, PersonaMessage.persona_id == persona_id)
                .order_by(PersonaMessage.created_at, PersonaMessage.id)
            )
        ).scalars()
    )


@router.get("/{venture_id}/personas/{persona_id}/messages", response_model=list[PersonaMessageRead])
async def list_persona_messages(
    venture_id: uuid.UUID,
    persona_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[PersonaMessageRead]:
    venture, _, _ = await _venture_and_persona(session, auth, venture_id, persona_id)
    return [_read(m) for m in await _messages(session, venture.id, persona_id)]


@router.post("/{venture_id}/personas/{persona_id}/messages", response_model=PersonaExchange)
async def send_persona_message(
    venture_id: uuid.UUID,
    persona_id: str,
    payload: PersonaMessageCreate,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
) -> PersonaExchange:
    """Saves the founder's message, then the AI persona's in-character reply."""
    venture, persona, responses = await _venture_and_persona(session, auth, venture_id, persona_id)
    count = (
        await session.execute(
            select(func.count())
            .select_from(PersonaMessage)
            .where(PersonaMessage.venture_id == venture.id, PersonaMessage.persona_id == persona_id)
        )
    ).scalar_one()
    if count + 2 > MAX_MESSAGES:
        raise HTTPException(status_code=409, detail="conversation_full")

    founder = PersonaMessage(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        persona_id=persona_id,
        role="founder",
        content=payload.content.strip(),
        # Set here, not by the database: now() is the same for every row in a
        # transaction, which would make the order of an exchange ambiguous.
        created_at=datetime.now(UTC),
    )
    session.add(founder)
    await session.flush()
    history = [{"role": m.role, "content": m.content} for m in (await _messages(session, venture.id, persona_id))[-HISTORY_FOR_AI:]]
    # The persona behaves like typical people matching its criteria in this market.
    market = await cached_market_profile(session, venture.id, persona_id, criteria_key(persona, responses))

    run = AIRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        operation="persona_chat",
        provider=type(provider).__name__,
        model=getattr(provider, "model", "unknown"),
        input_payload={
            "persona_id": persona_id,
            "messages": len(history),
            "language": payload.language,
            "market_grounded": market is not None,
        },
        status="pending",
    )
    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation="persona_chat",
    ):
        started = time.monotonic()
        try:
            reply = await provider.persona_reply(
                persona_profile_text(persona),
                venture_brief(venture, responses),
                history,
                payload.language,
                market_evidence=market_evidence_text(market),
            )
        except Exception as exc:
            # The founder's message is kept; the reply can be asked for again.
            run.status = "failed"
            run.error_message = f"{type(exc).__name__}: {exc}"[:2000]
            run.latency_ms = int((time.monotonic() - started) * 1000)
            session.add(run)
            await session.commit()
            if isinstance(exc, OpenAIError):
                raise
            logger.exception("Persona reply failed for venture %s", venture.id)
            raise HTTPException(status_code=503, detail="The persona couldn't reply. Please try again.") from exc

    persona_message = PersonaMessage(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        persona_id=persona_id,
        role="persona",
        content=reply.message.strip()[:MAX_MESSAGE_CHARS] or "…",
        # Always after the founder's message, even on a coarse clock.
        created_at=max(datetime.now(UTC), founder.created_at + timedelta(microseconds=1)),
    )
    session.add(persona_message)
    run.status = "succeeded"
    run.output_payload = {"reply_chars": len(persona_message.content)}
    run.latency_ms = int((time.monotonic() - started) * 1000)
    session.add(run)
    # Read the saved rows before committing: the organization scope (and so
    # RLS visibility) is per transaction.
    await session.flush()
    exchange = PersonaExchange(founder=_read(founder), persona=_read(persona_message))
    await session.commit()
    return exchange


@router.delete("/{venture_id}/personas/{persona_id}/messages", status_code=204)
async def reset_persona_conversation(
    venture_id: uuid.UUID,
    persona_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Starts the conversation with this persona over."""
    venture, _, _ = await _venture_and_persona(session, auth, venture_id, persona_id)
    await session.execute(
        delete(PersonaMessage).where(PersonaMessage.venture_id == venture.id, PersonaMessage.persona_id == persona_id)
    )
    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="persona.conversation_reset",
            resource_type="venture",
            resource_id=venture.id,
        )
    )
    await session.commit()
    return Response(status_code=204)


@router.get("/{venture_id}/personas/{persona_id}/market-profile")
async def get_persona_market_profile(
    venture_id: uuid.UUID,
    persona_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """The market research behind this persona, for its current criteria."""
    venture, persona, responses = await _venture_and_persona(session, auth, venture_id, persona_id)
    profile = await cached_market_profile(session, venture.id, persona_id, criteria_key(persona, responses))
    if profile is None:
        raise HTTPException(status_code=404, detail="not_researched")
    return profile


@router.post("/{venture_id}/personas/{persona_id}/market-profile")
async def research_persona_market_profile(
    venture_id: uuid.UUID,
    persona_id: str,
    payload: MarketProfileRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
) -> dict:
    """Researches (web search) what the general market says about people
    matching this persona's criteria. Cached per criteria: run again only when
    the criteria or location change, or on refresh."""
    venture, persona, responses = await _venture_and_persona(session, auth, venture_id, persona_id)
    key = criteria_key(persona, responses)
    if not payload.refresh:
        cached = await cached_market_profile(session, venture.id, persona_id, key)
        if cached is not None:
            return cached

    profile_text = persona_profile_text(persona)
    run = AIRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        operation="persona_market",
        provider=type(provider).__name__,
        model=getattr(provider, "model", "unknown"),
        input_payload={"persona_id": persona_id, "criteria_key": key, "profile": profile_text, "language": payload.language},
        status="pending",
    )
    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation="persona_market",
    ):
        started = time.monotonic()
        try:
            result = await provider.research_persona_market(profile_text, venture_brief(venture, responses), payload.language)
        except Exception as exc:
            run.status = "failed"
            run.error_message = f"{type(exc).__name__}: {exc}"[:2000]
            run.latency_ms = int((time.monotonic() - started) * 1000)
            session.add(run)
            await session.commit()
            if isinstance(exc, OpenAIError):
                raise
            logger.exception("Persona market research failed for venture %s", venture.id)
            raise HTTPException(status_code=503, detail="Market research failed. Please try again.") from exc

    profile = market_profile_payload(result, persona_id, key, payload.language, datetime.now(UTC))
    run.status = "succeeded"
    run.output_payload = profile
    run.latency_ms = int((time.monotonic() - started) * 1000)
    session.add(run)
    await session.commit()
    return profile
