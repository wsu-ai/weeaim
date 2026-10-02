"""Stage 4 (Existing Alternatives): research context and stored result.

The research is based on what the founder entered in stages 1-3, so the
context is assembled here from their saved answers. Links get the same
deterministic checks as Stage 1 (see app/wizard/idea_research.py).
"""

import json
from datetime import datetime

from app.ai.schemas import AlternativesResearchResult
from app.models import Venture, WizardResponse
from app.wizard.idea_research import _host, known_hosts, verified_url, web_search_url

STAGE_LABELS = {
    "idea_discovery": "Stage 1 - Idea discovery",
    "problem_definition": "Stage 2 - Problem definition",
    "customer_definition": "Stage 3 - Customer definition",
}


def venture_context(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """Everything the founder said in stages 1-3, plus the Stage 1 research summary."""
    lines = [f"Title: {venture.title}"]
    for label, value in (("Industry", venture.industry), ("Geography", venture.geography)):
        if value:
            lines.append(f"{label}: {value}")
    for slug, label in STAGE_LABELS.items():
        response = responses.get(slug)
        answers = {k: v for k, v in ((response.answers or {}) if response else {}).items() if v}
        lines.append(f"{label} answers: {json.dumps(answers, ensure_ascii=False)}")
    research = responses.get("idea_discovery")
    analysis = research.ai_analysis if research else None
    if isinstance(analysis, dict) and analysis.get("summary"):
        lines.append(f"Stage 1 research summary: {analysis['summary']}")
    return "\n".join(lines)


def based_on(responses: dict[str, WizardResponse]) -> str | None:
    """When the stage 1-3 answers the research used were last changed."""
    times = [r.updated_at for slug, r in responses.items() if slug in STAGE_LABELS and r.updated_at]
    return max(times).isoformat() if times else None


def alternatives_payload(
    result: AlternativesResearchResult,
    language: str,
    researched_at: datetime,
    based_on_at: str | None,
) -> dict:
    sources = [s for s in result.sources if _host(s.url)]
    hosts = known_hosts(sources, result.consulted_urls)
    return {
        "kind": "alternatives_research",
        **result.research.model_dump(exclude={"alternatives"}),
        "alternatives": [
            {
                **alt.model_dump(),
                "url": verified_url(alt.url, hosts),
                "search_url": web_search_url(alt.name),
            }
            for alt in result.research.alternatives
        ],
        "sources": [s.model_dump() for s in sources],
        "researched_at": researched_at.isoformat(),
        "based_on": based_on_at,
        "language": language,
    }
