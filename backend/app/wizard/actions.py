"""Action items shared by the stages that end in a checklist (7 and 8).

Each item gets a stable ID from its normalized title, so a tick the founder
saved (in the stage's `completed_actions` answer) survives a Refresh that
returns the same action.
"""

import hashlib
import re

from pydantic import BaseModel


def action_id(title: str) -> str:
    normalized = re.sub(r"\s+", " ", title).strip().casefold()
    return hashlib.sha256(normalized.encode()).hexdigest()[:12]


def with_action_ids(items: list[BaseModel]) -> list[dict]:
    """Dumps the items with an `id` each; a repeated title still gets a unique ID."""
    actions = []
    seen: set[str] = set()
    for item in items:
        base = action_id(item.title)
        id_, n = base, 2
        while id_ in seen:
            id_, n = f"{base}-{n}", n + 1
        seen.add(id_)
        actions.append({"id": id_, **item.model_dump()})
    return actions
