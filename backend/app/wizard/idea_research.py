"""Turns a provider's idea research into what's stored and shown (Stage 1).

Deterministic safeguards and scoring on model output before it reaches the
browser:
- A business's website link is kept only when the web search actually cited
  or consulted that site; a link the model produced on its own may be
  invented. Every business also gets a web-search link as a fallback.
- Only http(s) links survive.
- The "degree of feasibility" percentage is computed here, by fixed rules,
  from the model's factor ratings -- never taken from the model as a number
  (CLAUDE.md: deterministic code for scoring).
"""

from datetime import datetime
from urllib.parse import quote_plus, urlparse

from app.ai.schemas import FeasibilityFactors, IdeaResearchResult

# Points per rating; every factor weighs the same.
FEASIBILITY_POINTS = {"favorable": 100, "moderate": 60, "challenging": 20}
FEASIBILITY_FACTOR_ORDER = (
    "technical_complexity",
    "resources_required",
    "regulatory_barriers",
    "time_to_market",
    "customer_access",
)

WEB_SEARCH_URL = "https://www.google.com/search?q={query}"


def _host(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    return parsed.hostname.lower().removeprefix("www.")


def _same_site(host: str, known: str) -> bool:
    return host == known or host.endswith("." + known) or known.endswith("." + host)


def known_hosts(sources: list, consulted_urls: list[str]) -> set[str]:
    """Sites the web search actually cited or consulted."""
    hosts = {_host(s.url) for s in sources} | {_host(url) for url in consulted_urls}
    return {h for h in hosts if h}


def verified_url(url: str | None, hosts: set[str]) -> str | None:
    """The url, if its site was seen by the search; otherwise None."""
    host = _host(url)
    if host is None or not any(_same_site(host, known) for known in hosts):
        return None
    return url.strip()


def web_search_url(name: str) -> str:
    return WEB_SEARCH_URL.format(query=quote_plus(name))


def feasibility_score(factors: FeasibilityFactors) -> int:
    """Average of the factor points, as a whole percentage (0-100)."""
    points = [FEASIBILITY_POINTS[getattr(factors, name).rating] for name in FEASIBILITY_FACTOR_ORDER]
    return round(sum(points) / len(points))


def research_payload(result: IdeaResearchResult, language: str, researched_at: datetime) -> dict:
    sources = [s for s in result.sources if _host(s.url)]
    hosts = known_hosts(sources, result.consulted_urls)

    solutions = [
        {
            **solution.model_dump(),
            "url": verified_url(solution.url, hosts),
            # Always lets the user find the business, even unverified.
            "search_url": web_search_url(solution.name),
        }
        for solution in result.research.existing_solutions
    ]

    factors = result.research.feasibility_factors
    return {
        "kind": "idea_research",
        **result.research.model_dump(exclude={"existing_solutions", "feasibility_factors"}),
        "existing_solutions": solutions,
        "feasibility_factors": {
            name: getattr(factors, name).model_dump() for name in FEASIBILITY_FACTOR_ORDER
        },
        "feasibility_score": feasibility_score(factors),
        "sources": [s.model_dump() for s in sources],
        "researched_at": researched_at.isoformat(),
        "language": language,
    }
