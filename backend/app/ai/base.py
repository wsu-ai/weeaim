from typing import Protocol

from pydantic import BaseModel

from app.ai.schemas import (
    ProfessorNotes,
    StudyGuide,
    AgentTurn,
    PersonaMarketResult,
    PersonaInsights,
    PersonaReply,
    TranslationBatch,
    MarketingPlanResult,
    FinancialDraft,
    ValidationPlan,
    MvpConcept,
    BusinessModelResult,
    AlternativesResearchResult,
    CompetitivePositionResult,
    DfvAssessment,
    IdeaInterpretation,
    IdeaResearchResult,
    MarketResearchResult,
    ReportSynthesis,
    StageAnalysis,
)


class AIProvider(Protocol):
    async def structure_idea(self, idea_text: str) -> IdeaInterpretation: ...

    async def analyze_stage(
        self, stage_slug: str, idea_context: str, answers: dict, agent_drafts: dict | None = None
    ) -> StageAnalysis: ...

    async def produce_report(
        self, idea_context: str, stage_summaries: list[dict], evidence: list[dict]
    ) -> ReportSynthesis: ...

    async def research_idea(self, idea_context: str, language: str) -> IdeaResearchResult: ...

    async def research_alternatives(
        self, venture_context: str, language: str
    ) -> AlternativesResearchResult: ...

    async def research_market(self, venture_context: str, language: str) -> MarketResearchResult: ...

    async def research_competitive_position(
        self, venture_context: str, language: str
    ) -> CompetitivePositionResult: ...

    async def assess_dfv(self, venture_context: str, language: str) -> DfvAssessment: ...

    async def research_business_model(
        self, venture_context: str, language: str
    ) -> BusinessModelResult: ...

    async def research_mvp(self, venture_context: str, language: str) -> MvpConcept: ...

    async def generate_product_image(self, prompt: str) -> bytes: ...

    async def plan_validation(self, venture_context: str, language: str) -> ValidationPlan: ...

    async def draft_financials(self, venture_context: str, language: str) -> FinancialDraft: ...

    async def research_marketing_plan(
        self, venture_context: str, language: str
    ) -> MarketingPlanResult: ...

    async def translate_texts(self, texts: dict[str, str], language: str) -> TranslationBatch: ...

    async def persona_reply(
        self,
        persona_profile: str,
        venture_brief: str,
        history: list[dict],
        language: str,
        market_evidence: str = "",
    ) -> PersonaReply: ...

    async def research_persona_market(
        self, persona_profile: str, venture_brief: str, language: str
    ) -> PersonaMarketResult: ...

    async def summarize_persona_insights(self, venture_context: str, language: str) -> PersonaInsights: ...

    async def agent_turn(
        self,
        *,
        instructions: str,
        input: str | list[dict],
        tools: list[dict],
        web_search: bool,
        previous_response_id: str | None,
        output_schema: type[BaseModel],
        force_final: bool,
    ) -> AgentTurn:
        """One turn of an agent loop: the model either calls tools or returns
        output_schema. input is the goal (first turn) or the tool results."""
        ...

    async def professor_notes(self, stage_context: str, language: str) -> ProfessorNotes:
        """Teaching notes for one wizard stage (stage_context is untrusted data)."""
        ...

    async def study_guide(self, stage_context: str, language: str) -> StudyGuide:
        """A study guide for one wizard stage (stage_context is untrusted data)."""
        ...
