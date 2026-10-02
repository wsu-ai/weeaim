from pydantic import BaseModel

from app.wizard.schemas import (
    CustomerDefinitionAnswers,
    ExistingAlternativesAnswers,
    IdeaDiscoveryAnswers,
    ProblemDefinitionAnswers,
    ValuePropositionAnswers,
)

STAGE_ANSWER_SCHEMAS: dict[str, type[BaseModel]] = {
    "idea_discovery": IdeaDiscoveryAnswers,
    "problem_definition": ProblemDefinitionAnswers,
    "customer_definition": CustomerDefinitionAnswers,
    "existing_alternatives": ExistingAlternativesAnswers,
    "value_proposition": ValuePropositionAnswers,
}

# A stage stays locked until every stage listed here is completed. Checked on
# every read and write, so it re-locks if a prerequisite is edited again.
STAGE_PREREQUISITES: dict[str, list[str]] = {
    "existing_alternatives": ["idea_discovery", "problem_definition", "customer_definition"],
}

# Stages whose AI output is web research rather than generic feedback.
RESEARCH_STAGES = {"idea_discovery", "existing_alternatives"}
