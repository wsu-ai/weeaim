ALLOWED_CONTENT_TYPES: dict[str, set[str]] = {
    ".pdf": {"application/pdf"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".txt": {"text/plain"},
    ".csv": {"text/csv", "application/vnd.ms-excel", "application/csv"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
}

# Only checked where a reliable magic number exists. TXT/CSV have none, and
# DOCX/XLSX share the same ZIP signature (distinguishing them fully would
# mean inspecting the archive's internal parts) -- this confirms "is this
# really the container format it claims to be," not the exact office type.
_MAGIC_BYTES: dict[str, bytes] = {
    ".pdf": b"%PDF",
    ".docx": b"PK\x03\x04",
    ".xlsx": b"PK\x03\x04",
}


class DocumentValidationError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def validate_upload(
    filename: str, content_type: str, content: bytes, max_size_bytes: int
) -> str:
    """Returns the validated lowercase extension, or raises DocumentValidationError."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ALLOWED_CONTENT_TYPES:
        raise DocumentValidationError(415, f"Unsupported file extension: {ext or '(none)'}")

    if content_type not in ALLOWED_CONTENT_TYPES[ext]:
        raise DocumentValidationError(415, f"Unexpected content type for {ext}: {content_type}")

    magic = _MAGIC_BYTES.get(ext)
    if magic is not None and not content.startswith(magic):
        raise DocumentValidationError(415, f"File content doesn't match its {ext} extension")

    if len(content) > max_size_bytes:
        raise DocumentValidationError(413, "File exceeds the maximum upload size")

    return ext
