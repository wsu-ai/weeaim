"""Core tools shared by the stage agents.

Every tool works on the run's own venture (AgentContext), inside the
organization's RLS scope -- the model can name a stage, never a venture.
"""

from pydantic import BaseModel, Field

from app.agents.spec import AgentContext, AgentTool, PauseForFounder, ToolError


class ReadStageArgs(BaseModel):
    slug: str = Field(description="The stage to read, e.g. problem_definition.")


async def _read_stage(ctx: AgentContext, args: ReadStageArgs) -> dict:
    if args.slug not in ctx.spec.readable_stages:
        raise ToolError(f"You can only read these stages: {', '.join(ctx.spec.readable_stages)}")
    response = ctx.responses.get(args.slug)
    if response is None:
        return {"stage": args.slug, "status": "not_started", "answers": {}}
    analysis = response.ai_analysis if isinstance(response.ai_analysis, dict) else {}
    return {
        "stage": args.slug,
        "status": response.status,
        "answers": {k: v for k, v in (response.answers or {}).items() if v},
        "ai_summary": analysis.get("summary"),
    }


read_stage = AgentTool(
    name="read_stage",
    description="Read the founder's saved answers and the AI summary for one earlier stage.",
    args_model=ReadStageArgs,
    run=_read_stage,
)


def propose_answers_tool(answers_model: type[BaseModel]) -> AgentTool:
    """Draft answers for the stage's questions. Stored on the run for the
    founder to review -- never written to the stage."""

    async def run(ctx: AgentContext, args: BaseModel) -> dict:
        ctx.run.proposed_answers = args.model_dump()
        return {"saved": True, "note": "The founder will review these drafts."}

    return AgentTool(
        name="propose_answers",
        description=(
            "Draft answers to this stage's questions for the founder to review. "
            "Call it once, near the end, with all fields."
        ),
        args_model=answers_model,
        run=run,
    )


class AskFounderArgs(BaseModel):
    question: str = Field(max_length=500, description="One short, specific question.")


async def _ask_founder(ctx: AgentContext, args: AskFounderArgs) -> dict:
    if ctx.run.questions_asked >= ctx.spec.max_questions:
        raise ToolError("No more questions are allowed; continue with what you have.")
    raise PauseForFounder(args.question)


ask_founder = AgentTool(
    name="ask_founder",
    description=(
        "Ask the founder one question and wait for the answer. Only for something "
        "essential that the other tools cannot tell you."
    ),
    args_model=AskFounderArgs,
    run=_ask_founder,
)
