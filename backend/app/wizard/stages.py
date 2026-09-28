from pydantic import BaseModel

from app.wizard.schemas import (
    CustomerDefinitionAnswers,
    ProblemDefinitionAnswers,
    ValuePropositionAnswers,
)

STAGE_ANSWER_SCHEMAS: dict[str, type[BaseModel]] = {
    "problem_definition": ProblemDefinitionAnswers,
    "customer_definition": CustomerDefinitionAnswers,
    "value_proposition": ValuePropositionAnswers,
}
