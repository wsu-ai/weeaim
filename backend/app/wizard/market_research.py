"""Stage 6 (Market Evidence): context, market sizing and the stored result.

The market is sized for three geographies -- global, the founder's country
and the founder's metropolitan city (from the Stage 6 answers). For each,
TAM / SAM / SOM are computed HERE, deterministically, from the sourced inputs
the AI found -- never taken from the model (CLAUDE.md: use application code,
not LLM output, for financial calculations):

    TAM = total target customers x annual revenue per customer
    SAM = TAM x serviceable share
    SOM = SAM x obtainable share

Every figure's source is checked against what the web search actually cited
or consulted; an unconfirmed source keeps its title but loses its link, and
gets a web-search link instead (a model-written URL may be invented).
"""

import json
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from app.ai.schemas import MarketResearchResult, MarketScope, SourcedFigure
from app.models import Venture, WizardResponse
from app.wizard.idea_research import _host, known_hosts, verified_url, web_search_url

STAGE_LABELS = {
    "idea_discovery": "Stage 1 - Idea discovery",
    "problem_definition": "Stage 2 - Problem definition",
    "customer_definition": "Stage 3 - Customer definition",
    "existing_alternatives": "Stage 4 - Existing alternatives",
    "value_proposition": "Stage 5 - Value proposition",
    "market_evidence": "Stage 6 - Founder's market assumptions",
}
RESEARCH_SUMMARIES = {
    "idea_discovery": "Stage 1 research summary",
    "existing_alternatives": "Stage 4 alternatives research summary",
}
_WHOLE = Decimal("1")
SCOPE_ORDER = ("global", "country", "metro")


class LocationMissing(ValueError):
    """Stage 6 research needs the founder's country and metropolitan city."""


def founder_location(responses: dict[str, WizardResponse]) -> tuple[str, str]:
    response = responses.get("market_evidence")
    answers = (response.answers or {}) if response else {}
    country = str(answers.get("user_country") or "").strip()
    city = str(answers.get("user_metro_city") or "").strip()
    if not country or not city:
        raise LocationMissing("Enter your country and metropolitan city first")
    return country, city


def _decimal(value: float) -> Decimal:
    # Via str() so 0.1 stays 0.1 rather than its binary approximation.
    return Decimal(str(value))


def compute_market_sizes(research: MarketScope) -> dict:
    """TAM, SAM and SOM in whole currency units, from one scope's sourced inputs."""
    customers = _decimal(research.total_customers.value)
    revenue = _decimal(research.annual_revenue_per_customer.value)
    tam = customers * revenue
    sam = tam * _decimal(research.serviceable_share.value)
    som = sam * _decimal(research.obtainable_share.value)
    return {
        "currency": research.currency.strip().upper(),
        "tam": int(tam.quantize(_WHOLE, rounding=ROUND_HALF_UP)),
        "sam": int(sam.quantize(_WHOLE, rounding=ROUND_HALF_UP)),
        "som": int(som.quantize(_WHOLE, rounding=ROUND_HALF_UP)),
    }


def market_context(venture: Venture, responses: dict[str, WizardResponse]) -> str:
    """Everything the founder entered in stages 1-6, plus earlier research summaries."""
    country, city = founder_location(responses)
    lines = [
        f"Founder's location: country = {country}; metropolitan city = {city}",
        f"Title: {venture.title}",
    ]
    for label, value in (("Industry", venture.industry), ("Geography", venture.geography)):
        if value:
            lines.append(f"{label}: {value}")
    for slug, label in STAGE_LABELS.items():
        response = responses.get(slug)
        answers = {k: v for k, v in ((response.answers or {}) if response else {}).items() if v}
        if answers or slug != "market_evidence":
            lines.append(f"{label} answers: {json.dumps(answers, ensure_ascii=False)}")
    for slug, label in RESEARCH_SUMMARIES.items():
        response = responses.get(slug)
        analysis = response.ai_analysis if response else None
        if isinstance(analysis, dict) and analysis.get("summary"):
            lines.append(f"{label}: {analysis['summary']}")
    return "\n".join(lines)


def based_on(responses: dict[str, WizardResponse]) -> str | None:
    """When the stage 1-5 answers this research used were last changed."""
    times = [
        r.updated_at
        for slug, r in responses.items()
        if slug in STAGE_LABELS and slug != "market_evidence" and r.updated_at
    ]
    return max(times).isoformat() if times else None


def _link(url: str | None, hosts: set[str]) -> str | None:
    return verified_url(url, hosts)


def _sourced(item: dict, hosts: set[str], search_term: str | None) -> dict:
    """Adds source_verified; keeps the link only when the search saw that site."""
    url = _link(item.get("source_url"), hosts)
    return {
        **item,
        "source_url": url,
        "source_verified": url is not None,
        "search_url": web_search_url(search_term) if search_term else None,
    }


def _figure(figure: SourcedFigure, hosts: set[str]) -> dict:
    return _sourced(figure.model_dump(), hosts, figure.source_title)


def consistency_warnings(scopes: list[dict]) -> list[str]:
    """A city can't have more target customers than its country, nor a country
    more than the world. Compared on customer counts, so currencies don't matter."""
    customers = {s["scope"]: s["inputs"]["total_customers"]["value"] for s in scopes}
    warnings = []
    if "metro" in customers and "country" in customers and customers["metro"] > customers["country"]:
        warnings.append("metro_exceeds_country")
    if "country" in customers and "global" in customers and customers["country"] > customers["global"]:
        warnings.append("country_exceeds_global")
    return warnings


def _scope_payload(scope: MarketScope, hosts: set[str]) -> dict:
    return {
        "scope": scope.scope,
        "area_name": scope.area_name,
        "market_sizes": compute_market_sizes(scope),
        "inputs": {
            "total_customers": _figure(scope.total_customers, hosts),
            "annual_revenue_per_customer": _figure(scope.annual_revenue_per_customer, hosts),
            "serviceable_share": _figure(scope.serviceable_share, hosts),
            "obtainable_share": _figure(scope.obtainable_share, hosts),
        },
        "demographics": [
            _sourced(d.model_dump(), hosts, d.source_title) for d in scope.demographics
        ],
        "published_market_sizes": [
            _sourced(p.model_dump(), hosts, p.source_title) for p in scope.published_market_sizes
        ],
    }


def market_payload(
    result: MarketResearchResult,
    language: str,
    researched_at: datetime,
    based_on_at: str | None,
    location: tuple[str, str] | None = None,
) -> dict:
    research = result.research
    sources = [s for s in result.sources if _host(s.url)]
    hosts = known_hosts(sources, result.consulted_urls)

    # One entry per geography, in a fixed order; a repeated scope keeps its first.
    by_scope: dict[str, MarketScope] = {}
    for scope in research.scopes:
        by_scope.setdefault(scope.scope, scope)
    scopes = [_scope_payload(by_scope[name], hosts) for name in SCOPE_ORDER if name in by_scope]

    vendors = []
    for vendor in research.vendors:
        evidence_url = _link(vendor.evidence_url, hosts)
        vendors.append(
            {
                **vendor.model_dump(),
                "url": _link(vendor.url, hosts),
                "evidence_url": evidence_url,
                "evidence_verified": evidence_url is not None,
                "search_url": web_search_url(vendor.name),
            }
        )

    return {
        "kind": "market_research",
        "summary": research.summary,
        "location": {"country": location[0], "metro_city": location[1]} if location else None,
        "scopes": scopes,
        "consistency_warnings": consistency_warnings(scopes),
        "vendors": vendors,
        "assumptions": research.assumptions,
        "data_gaps": research.data_gaps,
        "suggested_next_steps": research.suggested_next_steps,
        "confidence": research.confidence,
        "sources": [s.model_dump() for s in sources],
        "researched_at": researched_at.isoformat(),
        "based_on": based_on_at,
        "language": language,
    }
