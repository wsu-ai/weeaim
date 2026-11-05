from pydantic import BaseModel

from app.wizard.schemas import (
    PersonaValidationAnswers,
    MarketingPlanAnswers,
    FinancialAnalysisAnswers,
    ValidationPlanAnswers,
    MvpAnswers,
    BusinessModelAnswers,
    CompetitivePositionAnswers,
    DfvAssessmentAnswers,
    CustomerDefinitionAnswers,
    ExistingAlternativesAnswers,
    IdeaDiscoveryAnswers,
    MarketEvidenceAnswers,
    ProblemDefinitionAnswers,
    ValuePropositionAnswers,
)

STAGE_ANSWER_SCHEMAS: dict[str, type[BaseModel]] = {
    "idea_discovery": IdeaDiscoveryAnswers,
    "problem_definition": ProblemDefinitionAnswers,
    "customer_definition": CustomerDefinitionAnswers,
    "existing_alternatives": ExistingAlternativesAnswers,
    "market_evidence": MarketEvidenceAnswers,
    "persona_validation": PersonaValidationAnswers,
    "value_proposition": ValuePropositionAnswers,
    "competitive_position": CompetitivePositionAnswers,
    "dfv_assessment": DfvAssessmentAnswers,
    "mvp": MvpAnswers,
    "business_model": BusinessModelAnswers,
    "validation_plan": ValidationPlanAnswers,
    "financial_analysis": FinancialAnalysisAnswers,
    "marketing_plan": MarketingPlanAnswers,
}

# A stage stays locked until every stage listed here is completed. Checked on
# every read and write, so it re-locks if a prerequisite is edited again.
STAGE_PREREQUISITES: dict[str, list[str]] = {
    "existing_alternatives": ["idea_discovery", "problem_definition", "customer_definition"],
    "market_evidence": [
        "idea_discovery",
        "problem_definition",
        "customer_definition",
        "existing_alternatives",
        "value_proposition",
    ],
    "competitive_position": [
        "idea_discovery",
        "problem_definition",
        "customer_definition",
        "existing_alternatives",
        "value_proposition",
        "market_evidence",
    ],
    # persona_validation (7), dfv_assessment (9), mvp (10), business_model
    # (11), validation_plan (12), financial_analysis (13) and marketing_plan
    # (14) are deliberately never locked: founders can run them at any time,
    # and missing stages count as missing evidence.
}

# Answer fields that only record progress (e.g. ticked Stage 7 action items).
# Changing just these keeps the stage's status and doesn't send later stages
# back for revision.
PROGRESS_FIELDS: dict[str, set[str]] = {
    "competitive_position": {"completed_actions"},
    "dfv_assessment": {"completed_actions"},
    "business_model": {"completed_actions"},
    # Recording results (and the server-computed outcomes) is progress.
    "validation_plan": {"experiment_results", "experiment_outcomes", "decision_signal"},
    "marketing_plan": {"completed_actions"},
    # Designing the mock-up in the Design Studio is progress, not a new answer.
    "mvp": {"mockup_design"},
}

# Stages whose AI output is web research rather than generic feedback.
RESEARCH_STAGES = {
    "idea_discovery",
    "existing_alternatives",
    "market_evidence",
    "persona_validation",
    "competitive_position",
    "dfv_assessment",
    "mvp",
    "business_model",
    "validation_plan",
    "financial_analysis",
    "marketing_plan",
}
