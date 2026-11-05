"""Counting the AI tokens a piece of work uses.

Providers call add_tokens() after every model, image or embedding call; it
adds to the meter opened by app.tokens.metered() around that work (and does
nothing when no meter is open). Context variables follow the async task, so
concurrent requests never mix their counts.
"""

from contextvars import ContextVar

_meter: ContextVar[list[int] | None] = ContextVar("token_meter", default=None)


def add_tokens(count: int | None) -> None:
    meter = _meter.get()
    if meter is not None and count:
        meter[0] += int(count)


def usage_tokens(response: object) -> int:
    """total_tokens from an OpenAI response's usage, 0 when absent."""
    usage = getattr(response, "usage", None)
    return int(getattr(usage, "total_tokens", 0) or 0)


def open_meter():
    """Starts counting; returns (the running count, a token to stop with)."""
    meter = [0]
    return meter, _meter.set(meter)


def close_meter(token) -> None:
    _meter.reset(token)
