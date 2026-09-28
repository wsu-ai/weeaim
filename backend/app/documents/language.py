_HANGUL_RANGES = (
    (0xAC00, 0xD7A3),  # Hangul syllables
    (0x1100, 0x11FF),  # Hangul jamo
    (0x3130, 0x318F),  # Hangul compatibility jamo
)


def _is_hangul(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in _HANGUL_RANGES)


def detect_language(text: str) -> str:
    """Heuristic en/ko detection: the two languages docs/product-requirements.md requires."""
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return "en"
    hangul_count = sum(1 for ch in letters if _is_hangul(ch))
    return "ko" if hangul_count / len(letters) > 0.2 else "en"
