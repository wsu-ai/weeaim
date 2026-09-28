from typing import Protocol

from app.ai.schemas import IdeaInterpretation


class AIProvider(Protocol):
    async def structure_idea(self, idea_text: str) -> IdeaInterpretation: ...
