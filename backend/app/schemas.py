import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class VentureCreate(BaseModel):
    idea: str = Field(min_length=20, max_length=2000)


class VentureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    title: str
    original_idea: str
    current_idea_statement: str | None
    status: str
    current_wizard_stage: str
    created_at: datetime
