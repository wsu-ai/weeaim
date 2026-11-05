"""Stage 7 (Personas Validation): founder-defined personas, persona chats,
and the insights summary.

The founder defines up to five target personas (saved in the stage's
answers). Each can be interviewed through an AI persona that role-plays that
customer; the conversations are saved in persona_messages (tenant-isolated).
"Summarize insights" turns the conversations into the stage's AI content.

Everything here is simulated: the UI and the summary say so, and quotes are
kept only if they appear word for word in what the persona actually said.
"""

import json
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schemas import PersonaInsights
from app.models import AIRun, Venture, WizardResponse
from app.wizard.competitive_position import DATA_END, DATA_START, _analysis, _pick

MAX_MESSAGES = 200  # per persona conversation
HISTORY_FOR_AI = 30  # most recent messages the persona sees
INCOME_LABELS = {
    "low": "low income",
    "lower_middle": "lower-middle income",
    "middle": "middle income",
    "upper_middle": "upper-middle income",
    "high": "high income",
}


def saved_personas(responses: dict[str, WizardResponse]) -> list[dict]:
    response = responses.get("persona_validation")
    personas = ((response.answers or {}) if response else {}).get("personas") or []
    return [p for p in personas if isinstance(p, dict) and p.get("id")]


def with_persona_ids(answers: dict) -> dict:
    """Gives every persona a stable ID (kept when it already has a valid one)."""
    personas = []
    seen: set[str] = set()
    for persona in answers.get("personas") or []:
        persona_id = str(persona.get("id") or "")
        try:
            persona_id = str(uuid.UUID(persona_id))
        except ValueError:
            persona_id = str(uuid.uuid4())
        if persona_id in seen:
            persona_id = str(uuid.uuid4())
        seen.add(persona_id)
        personas.append({**persona, "id": persona_id})
    return {**answers, "personas": personas}


def persona_profile_text(persona: dict) -> str:
    """The persona as the AI persona reads it."""
    lines = [
        f"Name: {persona.get('name', '')}",
        f"Age: {persona.get('age_min')}-{persona.get('age_max')}",
        f"Demographic: {persona.get('demographic', '')}",
        f"Income level: {INCOME_LABELS.get(persona.get('income_level'), persona.get('income_level'))}",
        f"Gender: {persona.get('gender')}",
        f"Marital status: {persona.get('marital_status')}",
    ]
    if persona.get("notes"):
        lines.append(f"Notes: {persona['notes']}")
    return "\n".join(lines)


def venture_brief(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """What the persona is reacting to: the idea, value proposition, MVP and place."""
    idea = responses.get("idea_discovery")
    value = responses.get("value_proposition")
    market = responses.get("market_evidence")
    lines = [f"Venture: {venture.title}"]
    statement = ((idea.answers or {}) if idea else {}).get("idea_statement") or venture.current_idea_statement or venture.original_idea
    lines.append(f"Idea: {statement}")
    proposition = ((value.answers or {}) if value else {}).get("value_proposition_statement")
    if proposition:
        lines.append(f"Value proposition: {proposition}")
    mvp = _analysis(responses, "mvp")
    if mvp.get("name"):
        lines.append(f"First version: {mvp.get('name')} - {mvp.get('summary', '')}")
    answers = (market.answers or {}) if market else {}
    if answers.get("user_country"):
        lines.append(f"Where: {answers.get('user_metro_city', '')}, {answers['user_country']}")
    return "\n".join(lines)


async def cached_market_profile(
    session: AsyncSession, venture_id: uuid.UUID, persona_id: str, key: str
) -> dict | None:
    """The latest market research for this persona's current criteria."""
    run = (
        await session.execute(
            select(AIRun)
            .where(
                AIRun.venture_id == venture_id,
                AIRun.operation == "persona_market",
                AIRun.status == "succeeded",
                AIRun.input_payload["persona_id"].astext == persona_id,
                AIRun.input_payload["criteria_key"].astext == key,
            )
            .order_by(AIRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return run.output_payload if run is not None else None


def _market_data(profile: dict) -> dict:
    """The parts of a market profile the summary reads (no URLs)."""
    keys = (
        "summary",
        "daily_life_and_habits",
        "current_alternatives",
        "spending_and_price_sensitivity",
        "adoption_signals",
        "likely_objections",
        "data_gaps",
    )
    data = {key: profile.get(key) for key in keys if profile.get(key)}
    data["facts"] = [
        {"fact": f.get("fact"), "source_verified": bool(f.get("source_verified"))} for f in profile.get("facts") or []
    ]
    return data


def insights_context(
    venture: Venture,
    responses: dict[str, WizardResponse],
    transcripts: dict[str, list[dict]],
    markets: dict[str, dict] | None = None,
) -> str:
    """The venture brief, then each persona with its market research and its
    conversation, as untrusted data. Personas with neither are left out."""
    markets = markets or {}
    data = [
        {
            "id": persona["id"],
            "profile": persona_profile_text(persona),
            "market_research": _market_data(markets[persona["id"]]) if persona["id"] in markets else None,
            "conversation": [
                {"speaker": "founder" if m["role"] == "founder" else "persona", "text": m["content"]}
                for m in transcripts.get(persona["id"], [])
            ],
        }
        for persona in saved_personas(responses)
        if transcripts.get(persona["id"]) or persona["id"] in markets
    ]
    body = json.dumps(data, ensure_ascii=False, indent=1).replace(DATA_END, "</ research_data>")
    return "\n".join([venture_brief(venture, responses), DATA_START, body, DATA_END])


def insights_payload(
    result: PersonaInsights,
    transcripts: dict[str, list[dict]],
    personas: list[dict],
    language: str,
    researched_at: datetime,
    markets: dict[str, dict] | None = None,
) -> dict:
    """Keeps only known personas and only quotes the persona actually said."""
    names = {p["id"]: p.get("name", "") for p in personas}
    per_persona = []
    for insight in result.per_persona:
        if insight.persona_id not in names:
            continue
        said = " ".join(m["content"] for m in transcripts.get(insight.persona_id, []) if m["role"] == "persona")
        per_persona.append(
            {
                **insight.model_dump(),
                "name": names[insight.persona_id],
                "quotes": [q for q in insight.quotes if q.strip() and q.strip() in said],
            }
        )
    return {
        "kind": "persona_insights",
        "summary": result.summary,
        "per_persona": per_persona,
        "assumptions_to_test_with_real_customers": result.assumptions_to_test_with_real_customers,
        "confidence": result.confidence,
        "simulated": True,
        "sources": [],
        "researched_at": researched_at.isoformat(),
        "based_on": None,
        # What the summary read: personas with a conversation, and personas
        # whose market research it used.
        "conversations_used": sum(1 for p in personas if transcripts.get(p["id"])),
        "market_profiles_used": sum(1 for p in personas if p["id"] in (markets or {})),
        "language": language,
    }


def research_summary(responses: dict[str, WizardResponse]) -> dict:
    """The personas and their insights, for later stages' context."""
    insights = _analysis(responses, "persona_validation")
    return {
        "personas": [persona_profile_text(p) for p in saved_personas(responses)],
        "simulated_insights": {
            **_pick(insights, ("summary", "assumptions_to_test_with_real_customers")),
            "per_persona": [
                _pick(i, ("name", "objections", "willingness_to_pay", "feasibility_signals", "viability_signals"))
                for i in insights.get("per_persona") or []
                if isinstance(i, dict)
            ],
        },
    }


# --- Market grounding ---------------------------------------------------------------
# Each persona chat is grounded in what the general market data says about
# people matching its criteria (web research, cached as an ai_runs result and
# redone when the criteria or the location change).

MARKET_FIELDS = ("age_min", "age_max", "demographic", "income_level", "gender", "marital_status", "notes")


def criteria_key(persona: dict, responses: dict[str, WizardResponse]) -> str:
    """A fingerprint of everything the market research depends on."""
    import hashlib

    market = responses.get("market_evidence")
    answers = (market.answers or {}) if market else {}
    basis = {
        **{field: persona.get(field) for field in MARKET_FIELDS},
        "country": answers.get("user_country"),
        "city": answers.get("user_metro_city"),
    }
    return hashlib.sha256(json.dumps(basis, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def market_profile_payload(result, persona_id: str, key: str, language: str, researched_at: datetime) -> dict:
    """The research with source links kept only when the search saw that site."""
    from app.wizard.idea_research import _host, known_hosts, verified_url

    sources = [s for s in result.sources if _host(s.url)]
    hosts = known_hosts(sources, result.consulted_urls)
    research = result.research
    facts = []
    for fact in research.facts:
        url = verified_url(fact.source_url, hosts)
        facts.append({**fact.model_dump(), "source_url": url, "source_verified": url is not None})
    return {
        "kind": "persona_market_profile",
        "persona_id": persona_id,
        "criteria_key": key,
        **research.model_dump(exclude={"facts"}),
        "facts": facts,
        "sources": [s.model_dump() for s in sources],
        "researched_at": researched_at.isoformat(),
        "language": language,
    }


def market_evidence_text(profile: dict | None) -> str:
    """The market profile as the AI persona reads it."""
    if not profile:
        return ""
    lines = [profile.get("summary", "")]
    lines += [f"- {fact.get('fact')}" for fact in profile.get("facts") or []]
    for key, label in (
        ("daily_life_and_habits", "Daily life"),
        ("current_alternatives", "What they use today"),
        ("spending_and_price_sensitivity", "Spending"),
        ("adoption_signals", "Adoption"),
        ("likely_objections", "Likely objections"),
    ):
        items = profile.get(key) or []
        if items:
            lines.append(f"{label}: " + "; ".join(items))
    return "\n".join(line for line in lines if line)


async def research_missing_market_profiles(session, provider, auth, venture, responses, language: str) -> None:
    """Researches the market for every saved persona that has no research for
    its current criteria yet (in parallel), and caches it like the chat page
    does (an ai_runs "persona_market" row each). A persona whose research fails
    is skipped; the summary goes ahead with what there is. Token caps apply."""
    import asyncio
    import logging
    import time
    from datetime import UTC

    from app.tokens import metered

    missing = []
    for persona in saved_personas(responses):
        key = criteria_key(persona, responses)
        if await cached_market_profile(session, venture.id, persona["id"], key) is None:
            missing.append((persona, key))
    if not missing:
        return
    brief = venture_brief(venture, responses)
    started = time.monotonic()
    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation="persona_market",
    ):
        results = await asyncio.gather(
            *(provider.research_persona_market(persona_profile_text(p), brief, language) for p, _ in missing),
            return_exceptions=True,
        )
    latency = int((time.monotonic() - started) * 1000)
    now = datetime.now(UTC)
    for (persona, key), result in zip(missing, results, strict=True):
        run = AIRun(
            organization_id=auth.organization_id,
            venture_id=venture.id,
            operation="persona_market",
            provider=type(provider).__name__,
            model=getattr(provider, "model", "unknown"),
            input_payload={
                "persona_id": persona["id"],
                "criteria_key": key,
                "profile": persona_profile_text(persona),
                "language": language,
            },
            status="pending",
            latency_ms=latency,
        )
        if isinstance(result, BaseException):
            logging.getLogger(__name__).warning("Persona market research failed: %s", result)
            run.status = "failed"
            run.error_message = f"{type(result).__name__}: {result}"[:2000]
        else:
            run.status = "succeeded"
            run.output_payload = market_profile_payload(result, persona["id"], key, language, now)
        session.add(run)
    await session.flush()
