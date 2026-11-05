"""Translating a stage's saved AI analysis into the founder's language.

Only human-readable text is sent for translation. App code decides what that
is, and puts the translations back into a copy of the analysis with the same
structure, so every number, ID, link, enum and computed figure stays exactly
as it was (ticked actions and recorded results keep matching). The copy is
cached in the analysis under "translations"; the original is never changed.
"""

import copy
import re

# Keys whose values (and everything under them) are never translated: IDs,
# links, codes, founder-entered location, computed figures and metadata.
SKIP_KEYS = {
    "id", "kind", "language", "researched_at", "analyzed_at", "based_on", "translations", "translated_from",
    "translation_version",
    "url", "search_url", "source_url", "evidence_url", "consulted_urls", "sources", "source_title",
    "currency", "location", "image", "image_prompt", "asset_id", "content_type",
    "primary_color", "accent_color", "brand_name", "icon",
    "scores", "health", "metrics", "rates", "budget", "market_sizes", "consistency_warnings",
    "verdict", "decision_signal", "offering_type_source",
}
# Enum values and codes: lowercase snake_case tokens such as "direct_competitor".
CODE = re.compile(r"^[a-z0-9_]+$")
URL = re.compile(r"^(https?://|www\.)", re.IGNORECASE)
MAX_TEXTS = 600
# Bump when the translation rules change, so cached translations are redone.
TRANSLATION_VERSION = 2
MAX_CHARS = 60_000


def translatable_texts(analysis: dict) -> dict[str, str]:
    """Every translatable string in the analysis, by path (e.g. "channels/0/why")."""
    found: dict[str, str] = {}

    def walk(value: object, path: str) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key not in SKIP_KEYS:
                    walk(child, f"{path}/{key}" if path else key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{path}/{index}")
        elif isinstance(value, str):
            text = value.strip()
            if text and not CODE.match(text) and not URL.match(text):
                found[path] = value

    walk(analysis, "")
    return found


def apply_translations(analysis: dict, translated: dict[str, str], language: str, source_language: str) -> dict:
    """A copy of the analysis with translated text in place. Unknown paths and
    paths that weren't strings are ignored; untranslated text stays as it was."""
    result = copy.deepcopy({k: v for k, v in analysis.items() if k != "translations"})
    allowed = translatable_texts(result)
    for path, text in translated.items():
        if path not in allowed or not isinstance(text, str) or not text.strip():
            continue
        *parents, last = path.split("/")
        node: object = result
        for part in parents:
            node = node[int(part)] if isinstance(node, list) else node[part]  # type: ignore[index]
        if isinstance(node, list):
            node[int(last)] = text
        elif isinstance(node, dict):
            node[last] = text
    result["language"] = language
    result["translated_from"] = source_language
    result["translation_version"] = TRANSLATION_VERSION
    return result


def batches(texts: dict[str, str], size: int = 120) -> list[dict[str, str]]:
    items = list(texts.items())
    return [dict(items[i : i + size]) for i in range(0, len(items), size)]


def source_language(analysis: dict) -> str:
    """The language an analysis was written in. Generic stage feedback has no
    language field and is written in English."""
    return analysis.get("language") if analysis.get("language") in ("en", "ko") else "en"


def cached_translation(analysis: dict, language: str) -> dict | None:
    """A cached translation, if it was made from this very analysis with the
    current translation rules."""
    cached = (analysis.get("translations") or {}).get(language)
    if (
        isinstance(cached, dict)
        and cached.get("researched_at") == analysis.get("researched_at")
        and cached.get("translation_version") == TRANSLATION_VERSION
    ):
        return cached
    return None
