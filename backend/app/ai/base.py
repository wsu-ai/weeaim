from typing import Protocol

from app.ai.schemas import IdeaInterpretation, StageAnalysis


class AIProvider(Protocol):
    async def structure_idea(self, idea_text: str) -> IdeaInterpretation: ...

    async def analyze_stage(
        self, stage_slug: str, idea_context: str, answers: dict
    ) -> StageAnalysis: ...
