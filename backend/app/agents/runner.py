"""The agent loop shared by every stage agent.

Each turn the model either calls tools -- run here, server-side, on the run's
own venture -- or returns the stage's structured output. Results go back to
the model as untrusted data. Turns, web searches, questions, tokens and wall
time are capped by the stage's AgentSpec. The finished result is saved like
single-call research (app/wizard/research_store.py); the stage's answers are
never changed -- drafts wait on the run for the founder.

Runs in its own session as the RLS-scoped app role, re-scoped to the run's
organization at the start of every transaction (set_config(..., true) only
lasts for one transaction).
"""

import json
import logging
import time
import uuid
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.spec import AgentContext, AgentSpec, PauseForFounder, ToolError
from app.ai.openai_provider import LANGUAGE_NAMES
from app.auth import AuthContext
from app.agents.stages import AGENT_SPECS
from app.ai.base import AIProvider
from app.ai.errors import ai_problem
from app.ai.schemas import ResearchSource
from app.config import settings
from app.db import async_session
from app.models import AgentRun, AgentRunStep, AIRun, Venture, WizardResponse, WizardStage
from app.tenancy import set_current_organization
from app.tokens import cap_reached
from app.tokens import record as record_tokens
from app.wizard.research_defs import FinalizeArgs, ResearchPrecondition
from app.wizard.research_store import save_stage_research

logger = logging.getLogger(__name__)

# Tool results larger than this are cut before they go back to the model.
MAX_TOOL_RESULT_CHARS = 8000
# What a step stores of a tool's arguments/result.
MAX_STORED_CHARS = 4000


def tool_output(call_id: str, result: dict, trusted: bool = False) -> dict:
    """A function_call_output item. Tool results are wrapped as untrusted
    data; only the runner's own error messages are not."""
    body = result if trusted else {"untrusted_data": result}
    text = json.dumps(body, ensure_ascii=False, default=str)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = json.dumps(
            {"untrusted_data": {"truncated": text[:MAX_TOOL_RESULT_CHARS]}}, ensure_ascii=False
        )
    return {"type": "function_call_output", "call_id": call_id, "output": text}


def _stored(value: dict | None) -> dict | None:
    if value is None:
        return None
    text = json.dumps(value, ensure_ascii=False, default=str)
    return value if len(text) <= MAX_STORED_CHARS else {"truncated": True}


class _Run:
    def __init__(self, session: AsyncSession, run: AgentRun, spec: AgentSpec, provider: AIProvider) -> None:
        self.session = session
        self.run = run
        self.spec = spec
        self.provider = provider
        self.started = time.monotonic()
        self.mark = self.started

    async def commit(self) -> None:
        now = time.monotonic()
        self.run.active_ms += int((now - self.mark) * 1000)  # time spent working
        self.mark = now
        self.run.heartbeat_at = datetime.now(UTC)
        await self.session.commit()
        await set_current_organization(self.session, self.run.organization_id)

    async def step(self, kind: str, tool_name: str | None = None, arguments=None, result=None) -> None:
        seq = (
            await self.session.execute(
                select(func.coalesce(func.max(AgentRunStep.seq), 0)).where(AgentRunStep.run_id == self.run.id)
            )
        ).scalar_one()
        self.session.add(
            AgentRunStep(
                organization_id=self.run.organization_id,
                run_id=self.run.id,
                seq=seq + 1,
                kind=kind,
                tool_name=tool_name,
                arguments=_stored(arguments),
                result=_stored(result),
            )
        )
        await self.session.flush()

    async def finish(self, status: str, error: str | None = None) -> None:
        self.run.status = status
        self.run.error = error
        self.run.finished_at = datetime.now(UTC)
        self.run.pending_call_id = None
        await self.commit()

    async def load(self) -> tuple[Venture, dict[str, WizardResponse]]:
        venture = await self.session.get(Venture, self.run.venture_id)
        rows = (
            await self.session.execute(
                select(WizardStage.slug, WizardResponse)
                .join(WizardResponse, WizardResponse.wizard_stage_id == WizardStage.id)
                .where(WizardResponse.venture_id == self.run.venture_id)
            )
        ).all()
        return venture, {slug: response for slug, response in rows}

    def gather(self, sources: list[ResearchSource], consulted: list[str]) -> None:
        gathered = dict(self.run.gathered or {})
        known = {s["url"] for s in gathered.get("sources", [])}
        gathered["sources"] = gathered.get("sources", []) + [
            s.model_dump() for s in sources if s.url not in known
        ]
        gathered["consulted_urls"] = list(dict.fromkeys(gathered.get("consulted_urls", []) + consulted))
        self.run.gathered = gathered  # reassigned so the JSONB change is saved

    def remember(self, next_input, previous_response_id: str | None, force_final: bool) -> None:
        """Where the run is, so a pause (or a restart) can continue from here."""
        self.run.gathered = {
            **(self.run.gathered or {}),
            "position": {
                "next_input": next_input,
                "previous_response_id": previous_response_id,
                "force_final": force_final,
            },
        }

    async def save_result(self, parsed) -> None:
        venture, responses = await self.load()
        gathered = self.run.gathered or {}
        # Prepared again, so the payload sees the stage's current data.
        prepared = await self.spec.prepare(self.session, venture, responses)
        result = self.spec.wrap(
            parsed,
            [ResearchSource(**s) for s in gathered.get("sources", [])],
            gathered.get("consulted_urls", []),
        )
        analysis = await self.spec.finalize(
            FinalizeArgs(
                session=self.session,
                provider=self.provider,
                auth=AuthContext(user_id=self.run.started_by, organization_id=self.run.organization_id),
                venture=venture,
                responses=responses,
                prepared=prepared,
                result=result,
                language=self.run.language,
                now=datetime.now(UTC),
            )
        )
        analysis["agent_run_id"] = str(self.run.id)
        stage = (
            await self.session.execute(select(WizardStage).where(WizardStage.slug == self.spec.slug))
        ).scalar_one()
        await save_stage_research(
            self.session,
            organization_id=self.run.organization_id,
            actor_user_id=self.run.started_by,
            venture=venture,
            stage=stage,
            response=responses.get(self.spec.slug),
            analysis=analysis,
            initial_answers=dict(prepared.initial_answers),
            run=AIRun(
                organization_id=self.run.organization_id,
                venture_id=venture.id,
                operation=self.spec.operation,
                provider=type(self.provider).__name__,
                model=getattr(self.provider, "model", "unknown"),
                input_payload={"agent_run_id": str(self.run.id), "language": self.run.language},
                status="pending",
                latency_ms=int((time.monotonic() - self.started) * 1000),
            ),
        )

    async def call_tools(self, calls, ctx: AgentContext) -> tuple[list[dict], tuple[str, str] | None]:
        """Runs the turn's tool calls. Returns their outputs, and the
        (call_id, question) of an ask_founder call that pauses the run."""
        outputs: list[dict] = []
        paused: tuple[str, str] | None = None
        for call in calls:
            tool = self.spec.tool(call.name)
            if tool is None:
                error = {"error": f"Unknown tool '{call.name}'. Use only the tools you were given."}
                await self.step("error", call.name, None, error)
                outputs.append(tool_output(call.call_id, error, trusted=True))
                continue
            try:
                args = tool.args_model.model_validate_json(call.arguments)
            except ValidationError as exc:
                error = {"error": "Invalid arguments", "details": exc.errors(include_url=False, include_context=False)}
                await self.step("error", call.name, None, error)
                outputs.append(tool_output(call.call_id, error, trusted=True))
                continue
            try:
                result = await tool.run(ctx, args)
            except ToolError as exc:
                error = {"error": str(exc)}
                await self.step("error", call.name, args.model_dump(), error)
                outputs.append(tool_output(call.call_id, error, trusted=True))
                continue
            except PauseForFounder as pause:
                if paused is not None:  # one question at a time
                    error = {"error": "Ask one question at a time."}
                    await self.step("error", call.name, args.model_dump(), error)
                    outputs.append(tool_output(call.call_id, error, trusted=True))
                    continue
                await self.step("question", call.name, {"question": pause.question})
                paused = (call.call_id, pause.question)
                continue
            await self.step("tool", call.name, args.model_dump(), result)
            outputs.append(tool_output(call.call_id, result))
        return outputs, paused

    async def loop(self, next_input, previous_response_id: str | None, force_final: bool = False) -> None:
        run, spec = self.run, self.spec
        while True:
            await self.session.refresh(run)
            if run.status in ("cancelled", "paused"):
                return  # a paused run continues from its saved position
            if run.tokens_used >= settings.agent_max_tokens or time.monotonic() - self.started > spec.max_seconds:
                # Which of the run's own limits it was, with the figures to explain it.
                await self.step(
                    "limit",
                    result={
                        "reason": "tokens" if run.tokens_used >= settings.agent_max_tokens else "time",
                        "tokens_used": run.tokens_used,
                        "token_limit": settings.agent_max_tokens,
                        "max_seconds": spec.max_seconds,
                    },
                )
                await self.finish("failed", "limit_reached")
                return
            # The organization's token caps (app/tokens.py) stop a run between turns.
            if (cap := await cap_reached(self.session, run.organization_id, run.venture_id)) is not None:
                await self.step("limit", result=cap)  # {"cap", "used", "limit"}
                await self.finish("failed", "token_limit_reached")
                return
            force_final = force_final or run.model_turns >= spec.max_turns - 1
            turn = await self.provider.agent_turn(
                instructions=spec.instructions,
                input=next_input,
                tools=[] if force_final else [t.schema() for t in spec.tools],
                web_search=spec.web_search and not force_final and run.web_searches < spec.max_web_searches,
                previous_response_id=previous_response_id,
                output_schema=spec.output_schema,
                force_final=force_final,
            )
            run.model_turns += 1
            run.tokens_used += turn.tokens
            record_tokens(
                self.session,
                organization_id=run.organization_id,
                venture_id=run.venture_id,
                user_id=run.started_by,
                operation="agent_turn",
                tokens=turn.tokens,
            )
            run.web_searches += turn.web_searches
            run.last_response_id = turn.response_id
            self.gather(turn.sources, turn.consulted_urls)
            await self.step("model", result={"tool_calls": len(turn.tool_calls), "tokens": turn.tokens})
            if turn.web_searches:
                await self.step("web_search", result={"count": turn.web_searches})

            if turn.final is not None:
                await self.session.refresh(run, ["status"])
                if run.status == "cancelled":
                    return  # a finished result still counts if a pause was requested
                await self.save_result(turn.final)
                await self.finish("succeeded")
                return
            if not turn.tool_calls:
                if force_final:
                    await self.finish("failed", "no_result")
                    return
                force_final = True
                next_input, previous_response_id = "Return the final result now.", turn.response_id
                self.remember(next_input, previous_response_id, force_final)
                await self.commit()
                continue

            venture, responses = await self.load()
            ctx = AgentContext(self.session, run, venture, responses, spec)
            outputs, paused = await self.call_tools(turn.tool_calls, ctx)
            if paused is not None:
                call_id, question = paused
                run.status = "waiting_for_founder"
                run.pending_call_id = call_id
                run.pending_question = question
                run.questions_asked += 1
                # The other calls' outputs go back together with the answer.
                run.gathered = {**(run.gathered or {}), "pending_outputs": outputs}
                await self.commit()
                return
            next_input, previous_response_id = outputs, turn.response_id
            self.remember(next_input, previous_response_id, force_final)
            await self.commit()


async def run_agent(
    run_id: uuid.UUID,
    organization_id: uuid.UUID,
    provider: AIProvider,
    founder_answer: str | None = None,
) -> None:
    """Runs one agent run until it finishes, waits for the founder, is
    paused, fails or is cancelled. Resumes a run that was waiting for an
    answer (founder_answer) or was paused (its saved position)."""
    async with async_session() as session:
        await set_current_organization(session, organization_id)
        run = await session.get(AgentRun, run_id)
        if run is None or run.status != "queued":
            return
        spec = AGENT_SPECS[run.stage_slug]
        state = _Run(session, run, spec, provider)
        try:
            force_final = False
            position = (run.gathered or {}).get("position")
            if founder_answer is not None and run.pending_call_id:
                gathered = dict(run.gathered or {})
                next_input = gathered.pop("pending_outputs", []) + [
                    tool_output(run.pending_call_id, {"founder_answer": founder_answer})
                ]
                run.gathered = gathered
                run.pending_call_id = None
                run.pending_question = None
                previous = run.last_response_id
            elif position is not None:  # resuming after a pause
                next_input = position["next_input"]
                previous = position["previous_response_id"]
                force_final = position["force_final"]
            else:
                venture, responses = await state.load()
                try:
                    prepared = await spec.prepare(session, venture, responses)
                except ResearchPrecondition as exc:
                    await state.finish("failed", exc.detail)
                    return
                next_input = spec.goal(prepared, run.language, LANGUAGE_NAMES.get(run.language, "English"))
                previous = None
                state.remember(next_input, previous, force_final)
            run.status = "running"
            await state.commit()
            await state.loop(next_input, previous, force_final)
        except Exception as exc:
            logger.exception("Agent run %s failed", run_id)
            await session.rollback()
            await set_current_organization(session, organization_id)
            run = await session.get(AgentRun, run_id)
            if run is not None and run.status in ("queued", "running"):
                state.run = run
                await state.step("error", result={"error": type(exc).__name__, "problem": ai_problem(exc)})
                await state.finish("failed", "agent_error")
